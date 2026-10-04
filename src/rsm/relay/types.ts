/**
 * Relay & conversation model — V3 interaction-aware delivery.
 *
 * Three DISTINCT identities (never collapsed — see ADR-2):
 *  - `bucket_id`       — canonical source identity (unchanged, immutable).
 *  - `conversation_id` — identity of one consuming session/runtime (RSM ON/OFF
 *                        scope + relay history). Default: created OFF.
 *  - `relay_id`        — identity of ONE delivery operation (one per interaction
 *                        or per manual Replay).
 *
 * Relay state (IDLE/PREPARING/STREAMING/COMPLETED/FAILED/CANCELLED) is TRANSIENT
 * RUNTIME state. It is deliberately kept separate from the bucket lifecycle state
 * machine (CAPTURED…CLOSED) and is never written into a bucket.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { LifecycleState } from "../bucket/types";

/**
 * A consuming session. RSM context is released to a conversation ONLY when
 * `rsm_enabled === true` (fail-closed, default OFF). A conversation selects
 * ZERO OR ONE bucket as its source set (V3 invariant).
 */
export interface Conversation {
  conversation_id: string;
  /** Fail-closed authorization switch. Default false (OFF). */
  rsm_enabled: boolean;
  /** Zero-or-one selected source bucket. `null` = no source selected. */
  selected_bucket_id: string | null;
  /** ISO-8601 UTC. */
  created_at: string;
  /** ISO-8601 UTC; bumped on every mutation. */
  updated_at: string;
}

/** Transient runtime states of one delivery. NOT bucket lifecycle states. */
export const RELAY_STATES = {
  Idle: "IDLE",
  Preparing: "PREPARING",
  Streaming: "STREAMING",
  Completed: "COMPLETED",
  Failed: "FAILED",
  Cancelled: "CANCELLED",
} as const;
export type RelayState = (typeof RELAY_STATES)[keyof typeof RELAY_STATES];

/** Terminal states — a relay never leaves these once entered. */
export const TERMINAL_RELAY_STATES: readonly RelayState[] = [
  RELAY_STATES.Completed,
  RELAY_STATES.Failed,
  RELAY_STATES.Cancelled,
];

export function isTerminalRelayState(state: RelayState): boolean {
  return TERMINAL_RELAY_STATES.includes(state);
}

/** Prepared snapshot reference carried by a relay (envelope ref + sealed hash). */
export interface RelaySnapshot {
  /** Reference to the prepared replay envelope (its `replay_id`). */
  envelope_ref: string;
  /** SHA-256 hex sealed over the canonical envelope payload. */
  envelope_hash: string;
  /** Lifecycle states that were eligible for this delivery. */
  states: LifecycleState[];
}

/**
 * One RSM delivery operation. Immutable identity (`relay_id`) with transient
 * `state`; `snapshot` is null until PREPARING completes the envelope build.
 */
export interface Relay {
  relay_id: string;
  conversation_id: string;
  /** The authorized source set — exactly the conversation's selected bucket. */
  bucket_ids: string[];
  /** Prepared envelope reference + sealed hash (null while building). */
  snapshot: RelaySnapshot | null;
  state: RelayState;
  /** ISO-8601 UTC creation time. */
  created_at: string;
  /** ISO-8601 UTC completion time; null until terminal. */
  streamed_at: string | null;
  /** Human-readable failure reason (never raw stack traces). null when none. */
  error: string | null;
}

/** Convenience: a fresh conversation, OFF by default. */
export function createConversation(
  conversationId: string,
  at: string = new Date().toISOString(),
): Conversation {
  return {
    conversation_id: conversationId,
    rsm_enabled: false,
    selected_bucket_id: null,
    created_at: at,
    updated_at: at,
  };
}
