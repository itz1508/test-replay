/**
 * RSM store hook — the UI shell's single access point to the RSM domain.
 *
 * The UI NEVER reimplements business logic. Everything here delegates to
 * `src/rsm/` (extraction, integrity, lifecycle, replay, transports) and talks
 * to persistence ONLY through the RsmRepository interface (IndexedDB backend).
 *
 * React/Vite live in this layer; the domain stays pure TypeScript.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as rsm from "../rsm";
import type { Bucket } from "../rsm/bucket/types";
import type { ExtractedSource, ExtractionLimits } from "../rsm/extraction/types";
import type { IngestOptions } from "../rsm/extraction";
import type { LifecycleAction, LifecycleEvent } from "../rsm/lifecycle/types";
import type { RsmRepository } from "../rsm/persistence/types";
import type { Conversation, Relay, RelayState } from "../rsm/relay/types";
import type { GateResult } from "../rsm/relay/gate";

/** One shared repository connection (idempotent across StrictMode remounts). */
let repoPromise: Promise<RsmRepository> | null = null;

function getRepo(): Promise<RsmRepository> {
  if (!repoPromise) {
    repoPromise = Promise.resolve(rsm.persistence.createIndexedDbRepository());
  }
  return repoPromise;
}

/** V3: identity of the single default consuming session. */
export const DEFAULT_CONVERSATION_ID = "rsm-default-conversation";

/** Turn any thrown domain error into a human sentence. */
export function humanErrorMessage(error: unknown): string {
  if (error instanceof rsm.RsmError) {
    switch (error.code) {
      case "INVALID_TRANSITION":
        return "That step isn't allowed from this bucket's current state.";
      case "INTEGRITY_MISMATCH":
        return "The content no longer matches its fingerprint — the bucket wasn't rewritten.";
      case "SOURCE_UNSUPPORTED":
        return error.message;
      case "SOURCE_TOO_LARGE":
        return error.message;
      case "PERSISTENCE_ERROR":
        return "The local store couldn't complete the write — try again?";
      case "CRYPTO_UNAVAILABLE":
        return "This browser doesn't expose the crypto needed for integrity checks (SHA-256).";
      case "NOT_FOUND":
        return "That bucket no longer exists in the local store.";
      case "DUPLICATE":
        return "A bucket with that identity already exists.";
      case "VALIDATION_ERROR":
        return error.message;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something unexpected went wrong.";
}

export interface VerifyOutcome {
  bucket: Bucket;
  ok: boolean;
  message: string;
}

export interface BatchOutcome {
  successes: { bucket: Bucket; events: LifecycleEvent[] }[];
  failures: { source: string; error: unknown }[];
}

export function useRsmStore() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  // ── V3 relay & conversation state ─────────────────────────────────────────
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [relayState, setRelayState] = useState<RelayState>(rsm.relay.RELAY_STATES.Idle);
  /** REAL delivery progress from the replay stream (never fabricated). */
  const [deliveryProgress, setDeliveryProgress] = useState<{
    relay_id: string;
    chunk_index: number;
    total_chunks: number;
    bytes: number;
  } | null>(null);
  const [lastRelay, setLastRelay] = useState<Relay | null>(null);
  const [lastRelayError, setLastRelayError] = useState<string | null>(null);
  const [gateResult, setGateResult] = useState<GateResult | null>(null);
  /** Abort controller for an in-flight delivery stream. */
  const deliveryAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const repo = await getRepo();
    setBuckets((await repo.listBuckets()).sort((a, b) => b.created_timestamp.localeCompare(a.created_timestamp)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repo = await getRepo();
        await repo.restore();
        if (cancelled) return;
        setBuckets(await repo.listBuckets());
        // V3: ensure the default conversation exists (OFF by default) and load
        // its most recent relay so the rail can show the last delivery.
        let conv = await repo.getConversation(DEFAULT_CONVERSATION_ID);
        if (!conv) {
          conv = rsm.relay.createConversation(DEFAULT_CONVERSATION_ID);
          await repo.saveConversation(conv);
        }
        if (cancelled) return;
        setConversation(conv);
        const relays = await repo.listRelaysForConversation(DEFAULT_CONVERSATION_ID);
        if (!cancelled && relays.length > 0) setLastRelay(relays[0]);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.name === "NotSupportedError"
            ? "This browser doesn't allow IndexedDB (private mode?). RSM needs a local store to run."
            : humanErrorMessage(err),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getEvents = useCallback(async (bucketId: string): Promise<LifecycleEvent[]> => {
    const repo = await getRepo();
    return repo.getEvents(bucketId);
  }, []);

  /**
   * Any legal non-VERIFY transition. STORE/READY preconditions (persisted /
   * ready proofs) are provided by this shell before persisting, per the
   * domain contract. Writes are atomic: full event history + new event.
   */
  const advance = useCallback(
    async (bucket: Bucket, action: LifecycleAction, reason?: string): Promise<Bucket> => {
      const repo = await getRepo();
      const events = await repo.getEvents(bucket.bucket_id);
      const options: rsm.lifecycle.TransitionOptions = {
        actor: "user",
        reason: reason?.trim() || undefined,
      };
      if (action === "STORE") options.persisted = true;
      if (action === "READY") options.ready = true;
      const { bucket: next, event } = rsm.lifecycle.transitionBucket(bucket, action, options);
      await repo.saveBucketWithEvents(next, [...events, event]);
      return next;
    },
    [],
  );

  /**
   * VERIFY or plain integrity re-check. If content no longer matches the
   * stored fingerprint, the INVALID status is persisted and NO transition is
   * made — RSM never silently rewrites content (AC: integrity is honest).
   */
  const verifyAndAdvance = useCallback(
    async (bucket: Bucket, reason?: string): Promise<VerifyOutcome> => {
      const repo = await getRepo();
      const verified = await rsm.integrity.verifyBucket(bucket);
      const updated = verified.bucket;
      const events = await repo.getEvents(bucket.bucket_id);

      if (updated.integrity_status === "INVALID") {
        await repo.saveBucketWithEvents(updated, events); // flag the break, don't transition
        return { bucket: updated, ok: false, message: verified.reason };
      }

      if (bucket.lifecycle_state === "CAPTURED" && rsm.lifecycle.isLegal("CAPTURED", "VERIFY")) {
        const { bucket: next, event } = rsm.lifecycle.transitionBucket(updated, "VERIFY", {
          actor: "user",
          reason: reason?.trim() || undefined,
        });
        await repo.saveBucketWithEvents(next, [...events, event]);
        return { bucket: next, ok: true, message: verified.reason };
      }

      await repo.saveBucketWithEvents(updated, events);
      return { bucket: updated, ok: true, message: verified.reason };
    },
    [],
  );

  const remove = useCallback(async (bucket: Bucket) => {
    const repo = await getRepo();
    await repo.deleteBucket(bucket.bucket_id);
  }, []);

  /** Ingest ONE extracted source all the way to READY. */
  const ingestOne = useCallback(
    async (extracted: ExtractedSource, options: IngestOptions = {}): Promise<Bucket> => {
      const repo = await getRepo();
      const { bucket } = await rsm.extraction.ingestExtracted(extracted, repo, options);
      return bucket;
    },
    [],
  );

  /** Ingest MANY extracted sources (batch — per-item failures don't abort). */
  const ingestBatch = useCallback(
    async (extractions: ExtractedSource[], options: IngestOptions = {}): Promise<BatchOutcome> => {
      const repo = await getRepo();
      const result = await rsm.extraction.ingestMany(extractions, repo, options);
      return {
        successes: result.successes,
        failures: result.failures,
      };
    },
    [],
  );

  // ── V3: conversation & relay flows ─────────────────────────────────────────

  /** Ensure the default conversation exists (OFF by default) and return it. */
  const ensureConversation = useCallback(async (): Promise<Conversation> => {
    const repo = await getRepo();
    let conv = await repo.getConversation(DEFAULT_CONVERSATION_ID);
    if (!conv) {
      conv = rsm.relay.createConversation(DEFAULT_CONVERSATION_ID);
      await repo.saveConversation(conv);
    }
    setConversation(conv);
    return conv;
  }, []);

  /** Persist the RSM ON/OFF switch (fail-closed default is OFF). */
  const toggleRsm = useCallback(async (enabled: boolean): Promise<Conversation> => {
    const conv = await ensureConversation();
    const next: Conversation = {
      ...conv,
      rsm_enabled: enabled,
      updated_at: new Date().toISOString(),
    };
    const repo = await getRepo();
    await repo.saveConversation(next);
    setConversation(next);
    return next;
  }, [ensureConversation]);

  /** Select (or clear) the conversation's source bucket. Refuses cross-bucket selection implicitly. */
  const selectBucket = useCallback(
    async (bucketId: string | null): Promise<Conversation> => {
      const conv = await ensureConversation();
      const next: Conversation = {
        ...conv,
        selected_bucket_id: bucketId,
        updated_at: new Date().toISOString(),
      };
      const repo = await getRepo();
      await repo.saveConversation(next);
      setConversation(next);
      return next;
    },
    [ensureConversation],
  );

  /** Shared core for startInteraction & replayOnce — gate → create → stream → persist terminal state. */
  const runRelay = useCallback(async (): Promise<Relay | null> => {
    const repo = await getRepo();
    const conv = await ensureConversation();

    // Fail-closed gate (conversation-level).
    const gate = rsm.relay.canDeliver(conv);
    setGateResult(gate);
    if (!gate.ok) {
      setLastRelayError(gate.message);
      setRelayState(rsm.relay.RELAY_STATES.Idle);
      return null;
    }

    // Gate again with the selected bucket identity (isolation: bucket MUST belong
    // to this conversation's source set).
    const selected = conv.selected_bucket_id ? await repo.getBucket(conv.selected_bucket_id) : null;
    if (!selected) {
      const refusal = rsm.relay.canDeliver(conv, conv.selected_bucket_id ?? undefined);
      setGateResult(refusal);
      setLastRelayError("Selected source is not available.");
      setRelayState(rsm.relay.RELAY_STATES.Idle);
      return null;
    }
    const bucketGate = rsm.relay.canDeliver(conv, selected.bucket_id);
    setGateResult(bucketGate);
    if (!bucketGate.ok) {
      setLastRelayError(bucketGate.message);
      setRelayState(rsm.relay.RELAY_STATES.Idle);
      return null;
    }

    // Create the relay (builds the envelope + seals hash).
    let prepared: rsm.relay.PreparedRelay;
    try {
      prepared = await rsm.relay.createRelay(conv, selected);
    } catch (err) {
      setLastRelayError(humanErrorMessage(err));
      setRelayState(rsm.relay.RELAY_STATES.Failed);
      return null;
    }

    const abort = new AbortController();
    deliveryAbortRef.current = abort;
    setRelayState(rsm.relay.RELAY_STATES.Preparing);
    setDeliveryProgress(null);
    setLastRelayError(null);

    // Stream honest chunks; persist relay at PREPARING (created) and terminal.
    await repo.saveRelay(prepared.relay);
    let finalRelay: Relay = prepared.relay;
    try {
      for await (const chunk of rsm.relay.streamRelay(prepared, { signal: abort.signal })) {
        if (chunk.kind === "chunk") {
          setRelayState(rsm.relay.RELAY_STATES.Streaming);
          setDeliveryProgress({
            relay_id: chunk.relay_id,
            chunk_index: chunk.chunk_index,
            total_chunks: chunk.total_chunks,
            bytes: chunk.bytes,
          });
        } else if (chunk.kind === "preparing") {
          setRelayState(rsm.relay.RELAY_STATES.Preparing);
        } else if (chunk.kind === "completed") {
          finalRelay = {
            ...prepared.relay,
            state: rsm.relay.RELAY_STATES.Completed,
            streamed_at: new Date().toISOString(),
            error: null,
          };
          await repo.saveRelay(finalRelay);
          setRelayState(rsm.relay.RELAY_STATES.Completed);
          setLastRelay(finalRelay);
          setLastRelayError(null);
        } else if (chunk.kind === "failed" || chunk.kind === "cancelled") {
          finalRelay = {
            ...prepared.relay,
            state: chunk.kind === "failed" ? rsm.relay.RELAY_STATES.Failed : rsm.relay.RELAY_STATES.Cancelled,
            streamed_at: new Date().toISOString(),
            error: chunk.error,
          };
          await repo.saveRelay(finalRelay);
          setRelayState(finalRelay.state);
          setLastRelayError(chunk.error);
        }
      }
    } finally {
      deliveryAbortRef.current = null;
    }
    return finalRelay;
  }, [ensureConversation]);

  /** Start an interaction: deliver the selected bucket's envelope via the ephemeral stream. */
  const startInteraction = useCallback(async (): Promise<Relay | null> => runRelay(), [runRelay]);

  /** Manual Replay: a fresh relay_id delivery of the selected bucket (new envelope + hash). */
  const replayOnce = useCallback(async (): Promise<Relay | null> => runRelay(), [runRelay]);

  /** Cancel an in-flight delivery stream (Escape handler in StreamSurface). */
  const cancelDelivery = useCallback(() => {
    deliveryAbortRef.current?.abort();
  }, []);

  /** Derive whether a delivery is actively streaming (for disable/focus logic). */
  const deliveryActive =
    relayState === rsm.relay.RELAY_STATES.Preparing || relayState === rsm.relay.RELAY_STATES.Streaming;

  /**
   * Clear the EPHEMERAL delivery surface back to IDLE. Transient runtime state
   * only — relay history stays persisted, buckets untouched (ADR-4: the stream
   * UI never becomes a persistent message).
   */
  const resetDelivery = useCallback(() => {
    setRelayState(rsm.relay.RELAY_STATES.Idle);
    setDeliveryProgress(null);
    setLastRelayError(null);
    setGateResult(null);
  }, []);

  return {
    ready,
    error,
    buckets,
    refresh,
    getEvents,
    advance,
    verifyAndAdvance,
    remove,
    ingestOne,
    ingestBatch,
    limits: rsm.extraction.DEFAULT_EXTRACTION_LIMITS as Required<ExtractionLimits>,
    // V3
    conversation,
    relayState,
    /** REAL delivery progress from the replay stream (never fabricated). */
    deliveryProgress,
    lastRelay,
    lastRelayError,
    gateResult,
    ensureConversation,
    toggleRsm,
    selectBucket,
    startInteraction,
    replayOnce,
    cancelDelivery,
    /** True while a delivery is PREPARING/STREAMING (disables replay CTA). */
    deliveryActive,
    /** Clear the ephemeral stream surface back to IDLE (ADR-4). */
    resetDelivery,
    rsmRelay: rsm.relay,
  };
}

export type RsmStore = ReturnType<typeof useRsmStore>;