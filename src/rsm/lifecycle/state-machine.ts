/**
 * Lifecycle state machine — transition validation, precondition enforcement,
 * and append-only event generation.
 *
 * Pure TypeScript — zero React/Vite/Supabase/AI dependencies. No persistence
 * assumptions: the state machine returns the new bucket + the event; the
 * repository layer persists both.
 */

import { RsmError } from "../errors";
import { randomUuid } from "../crypto/hash";
import type { Bucket } from "../bucket/types";
import { LIFECYCLE_EVENT_TYPES, TRANSITION_TABLE, type LifecycleAction, type LifecycleEvent, type LifecycleEventType } from "./types";

/** Canonical event type emitted per action (semantic best fit, documented). */
const ACTION_EVENT_TYPE: Record<LifecycleAction, LifecycleEventType> = {
  VERIFY: LIFECYCLE_EVENT_TYPES.Capture, // fingerprint bound — capture finalized
  STORE: LIFECYCLE_EVENT_TYPES.Store, // durably persisted
  READY: LIFECYCLE_EVENT_TYPES.Ingest, // ingest pipeline complete
  ACTIVATE: LIFECYCLE_EVENT_TYPES.Activate,
  RELEASE: LIFECYCLE_EVENT_TYPES.Release,
  CLOSE: LIFECYCLE_EVENT_TYPES.Close,
};

export interface TransitionOptions {
  /** Who initiated: "user" | "system" (default "user" for explicit actions). */
  actor?: string;
  /** Short reason recorded on the event (never raw user content). */
  reason?: string;
  /** REQUIRED for STORE: proof the store durably acknowledged the write. */
  persisted?: boolean;
  /** REQUIRED for READY: proof extraction/normalization completed. */
  ready?: boolean;
  /** Override event timestamp (ISO-8601 UTC); defaults to now. */
  at?: string;
  /** Override event id (stable replay); defaults to a fresh UUID. */
  eventId?: string;
}

/** Is the action legal from this state according to the canonical table? */
export function isLegal(state: string, action: LifecycleAction): boolean {
  return TRANSITION_TABLE[state as keyof typeof TRANSITION_TABLE]?.[action] !== undefined;
}

/** Legal actions reachable from a given state (for UI gating). */
export function legalActionsFor(state: string): LifecycleAction[] {
  const row = TRANSITION_TABLE[state as keyof typeof TRANSITION_TABLE];
  if (!row) return [];
  return (Object.keys(row) as LifecycleAction[]).filter((a) => row[a] !== undefined);
}

export interface TransitionResult {
  /** New bucket with lifecycle_state advanced. */
  bucket: Bucket;
  /** Immutable event to append to the bucket's event log. */
  event: LifecycleEvent;
}

/**
 * Attempt a canonical lifecycle transition.
 *
 * Rejects (throws RsmError INVALID_TRANSITION) when:
 * - the action is not legal from the current state, or
 * - a documented precondition is not satisfied:
 *   - VERIFY requires the bucket to carry a bound fingerprint (hash set and
 *     integrity VALID — i.e. integrity verification already ran).
 *   - STORE requires `options.persisted === true`.
 *   - READY requires `options.ready === true`.
 */
export function transitionBucket(bucket: Bucket, action: LifecycleAction, options: TransitionOptions = {}): TransitionResult {
  const currentState = bucket.lifecycle_state;
  const target = TRANSITION_TABLE[currentState]?.[action];

  if (target === undefined) {
    throw new RsmError(
      "INVALID_TRANSITION",
      `Transition ${currentState} --(${action})--> is not legal. Allowed actions from ${currentState}: ${legalActionsFor(currentState).join(", ") || "none (terminal)"}`,
    );
  }

  // Precondition checks (domain-owned, caller-provided proofs).
  let actor = options.actor;
  switch (action) {
    case "VERIFY":
      if (bucket.hash === null || bucket.integrity_status !== "VALID") {
        throw new RsmError(
          "INVALID_TRANSITION",
          "VERIFY requires a valid integrity fingerprint (run verifyBucket first, CAPTURED content must be intact).",
        );
      }
      break;
    case "STORE":
      if (options.persisted !== true) {
        throw new RsmError("INVALID_TRANSITION", "STORE requires a persistence acknowledgment (options.persisted === true).");
      }
      actor = "system";
      break;
    case "READY":
      if (options.ready !== true) {
        throw new RsmError("INVALID_TRANSITION", "READY requires extraction/normalization confirmation (options.ready === true).");
      }
      actor = "system";
      break;
    default:
      break; // ACTIVATE / RELEASE / CLOSE are explicit user actions, no extra gate.
  }

  const timestamp = options.at ?? new Date().toISOString();
  const event: LifecycleEvent = {
    event_id: options.eventId ?? randomUuid(),
    bucket_id: bucket.bucket_id,
    event_type: ACTION_EVENT_TYPE[action],
    timestamp,
    initiating_action: action,
    resulting_state: target,
    previous_state: currentState,
    actor: actor ?? (action === "VERIFY" ? "system" : "user"),
    reason: options.reason ?? null,
  };

  return {
    bucket: { ...bucket, lifecycle_state: target },
    event,
  };
}

/**
 * The ingest-time event recorded when a bucket is first created in CAPTURED.
 * Created through a dedicated function so the event log has a root entry.
 */
export function ingestEvent(bucket: Bucket, options: { actor?: string; reason?: string; at?: string; eventId?: string } = {}): LifecycleEvent {
  return {
    event_id: options.eventId ?? randomUuid(),
    bucket_id: bucket.bucket_id,
    event_type: LIFECYCLE_EVENT_TYPES.Ingest,
    timestamp: options.at ?? new Date().toISOString(),
    initiating_action: "INGEST",
    resulting_state: "CAPTURED",
    previous_state: "CAPTURED",
    actor: options.actor ?? "system",
    reason: options.reason ?? null,
  };
}