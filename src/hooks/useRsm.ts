/**
 * RSM store hook — the UI shell's single access point to the RSM domain.
 *
 * The UI NEVER reimplements business logic. Everything here delegates to
 * `src/rsm/` (extraction, integrity, lifecycle, replay, transports) and talks
 * to persistence ONLY through the RsmRepository interface (IndexedDB backend).
 *
 * React/Vite live in this layer; the domain stays pure TypeScript.
 */
import { useCallback, useEffect, useState } from "react";
import * as rsm from "../rsm";
import type { Bucket } from "../rsm/bucket/types";
import type { ExtractedSource, ExtractionLimits } from "../rsm/extraction/types";
import type { IngestOptions } from "../rsm/extraction";
import type { LifecycleAction, LifecycleEvent } from "../rsm/lifecycle/types";
import type { RsmRepository } from "../rsm/persistence/types";

/** One shared repository connection (idempotent across StrictMode remounts). */
let repoPromise: Promise<RsmRepository> | null = null;

function getRepo(): Promise<RsmRepository> {
  if (!repoPromise) {
    repoPromise = Promise.resolve(rsm.persistence.createIndexedDbRepository());
  }
  return repoPromise;
}

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
  };
}

export type RsmStore = ReturnType<typeof useRsmStore>;