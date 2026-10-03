/**
 * Replay envelope — the READ-ONLY ordered view of replayable buckets that is
 * handed to an LLM as external context.
 *
 * The envelope is a pure value: it embeds full canonical buckets, records who
 * was included (provenance entries), and seals the whole thing with
 * `envelope_hash` (SHA-256 over the canonical JSON of the payload).
 *
 * Replay NEVER mutates bucket content, state, or events — this module only
 * reads and wraps. Purely TypeScript, zero React/Vite/Supabase/AI imports.
 */

import { canonicalJson } from "../bucket/serialization";
import { getDefaultHasher, randomUuid, type Hasher } from "../crypto/hash";
import { SCHEMA_VERSION, type Bucket, type LifecycleState } from "../bucket/types";

/**
 * Which lifecycle states are eligible for replay. READY = staged context,
 * RELEASED = explicitly handed to a conversation. CAPTURED/VERIFIED/STORED are
 * not ready for consumption; ACTIVE is in-flight; CLOSED is retired.
 */
export const DEFAULT_REPLAY_STATES: readonly LifecycleState[] = ["READY", "RELEASED"];

/** One provenance entry — who was enrolled, in what state, at replay time. */
export interface ReplayProvenanceEntry {
  bucket_id: string;
  source: string;
  lifecycle_state: LifecycleState;
  /** Bucket fingerprint at replay time (null when unverified). */
  hash: string | null;
  captured_at: string;
}

/** Canonical replay envelope (schema_version "1"). */
export interface ReplayEnvelope {
  schema_version: string;
  replay_id: string;
  /** ISO-8601 UTC. */
  created_at: string;
  /** The lifecycle states that were eligible for this envelope. */
  states: LifecycleState[];
  /** Full canonical buckets, deterministic order (created_timestamp asc, then id). */
  buckets: Bucket[];
  /** SHA-256 hex over canonicalJson({ replay_id, created_at, states, buckets }). */
  envelope_hash: string;
  provenance: ReplayProvenanceEntry[];
}

export interface CreateReplayEnvelopeOptions {
  replayId?: string;
  /** Override timestamp (ISO-8601 UTC); defaults to now. */
  at?: string;
  hasher?: Hasher;
  /** Override the eligible states; defaults to DEFAULT_REPLAY_STATES. */
  states?: readonly LifecycleState[];
}

/** Is a bucket eligible for the replay envelope (configurable states)? */
export function isReplayable(
  bucket: Bucket,
  states: readonly LifecycleState[] = DEFAULT_REPLAY_STATES,
): boolean {
  return states.includes(bucket.lifecycle_state);
}

/**
 * Build a read-only replay envelope from the given buckets.
 *
 * Non-eligible buckets are silently excluded — the caller decides what to hand
 * in. Ordering is deterministic (created_at asc, then bucket_id asc) so two
 * builds over identical stores produce byte-identical envelopes apart from
 * `replay_id`/`created_at`.
 */
export async function createReplayEnvelope(
  buckets: Bucket[],
  options: CreateReplayEnvelopeOptions = {},
): Promise<ReplayEnvelope> {
  const states = [...(options.states ?? DEFAULT_REPLAY_STATES)];
  const eligible = buckets
    .filter((b) => states.includes(b.lifecycle_state))
    .sort(
      (a, b) =>
        a.created_timestamp.localeCompare(b.created_timestamp) ||
        a.bucket_id.localeCompare(b.bucket_id),
    );

  const replay_id = options.replayId ?? randomUuid();
  const created_at = options.at ?? new Date().toISOString();
  const hasher = options.hasher ?? getDefaultHasher();

  const payload = { replay_id, created_at, states, buckets: eligible };
  const envelope_hash = await hasher.sha256Hex(canonicalJson(payload));

  const provenance: ReplayProvenanceEntry[] = eligible.map((b) => ({
    bucket_id: b.bucket_id,
    source: b.source,
    lifecycle_state: b.lifecycle_state,
    hash: b.hash,
    captured_at: b.created_timestamp,
  }));

  return {
    schema_version: SCHEMA_VERSION,
    replay_id,
    created_at,
    states,
    buckets: eligible,
    envelope_hash,
    provenance,
  };
}