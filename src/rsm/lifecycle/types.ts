/**
 * Lifecycle types — canonical state machine contract and append-only events.
 *
 * States (PRD-authoritative):
 *   CAPTURED → VERIFIED → STORED → READY → ACTIVE → RELEASED → CLOSED
 *
 * Error handling: illegal transitions are REJECTED with INVALID_TRANSITION
 * (no hidden FAILED state — the canonical schema's lifecycle_state enum is
 * the PRD's seven states, keeping transport parity).
 *
 * Pure TypeScript — zero React/Vite/Supabase/AI dependencies.
 */

import type { LifecycleState } from "../bucket/types";

/** User/system actions that drive the state machine. */
export type LifecycleAction =
  | "VERIFY"
  | "STORE"
  | "READY"
  | "ACTIVATE"
  | "RELEASE"
  | "CLOSE";

/** Canonical event types (PRD list) + RSM_CLOSE (recorded decision). */
export const LIFECYCLE_EVENT_TYPES = {
  Ingest: "RSM_INGEST",
  Capture: "RSM_CAPTURE",
  Identify: "RSM_IDENTIFY",
  Store: "RSM_STORE",
  Activate: "RSM_ACTIVATE",
  Release: "RSM_RELEASE",
  Replay: "RSM_REPLAY",
  Expire: "RSM_EXPIRE",
  Close: "RSM_CLOSE",
} as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[keyof typeof LIFECYCLE_EVENT_TYPES];

/** One immutable, append-only lifecycle event. */
export interface LifecycleEvent {
  event_id: string;
  bucket_id: string;
  event_type: LifecycleEventType;
  /** ISO-8601 UTC. */
  timestamp: string;
  /** The action that caused this event ("INGEST" for capture-time events). */
  initiating_action: LifecycleAction | "INGEST";
  resulting_state: LifecycleState;
  previous_state: LifecycleState;
  /** Who initiated: "system" (automatic pipeline step) or "user" (explicit action). */
  actor: string;
  /** Short human-readable reason (never raw user content). */
  reason: string | null;
}

/**
 * Transition table: map every state to its legal actions and targets.
 * All transitions not listed here are invalid (INVALID_TRANSITION).
 */
export const TRANSITION_TABLE: Record<LifecycleState, Partial<Record<LifecycleAction, LifecycleState>>> = {
  CAPTURED: { VERIFY: "VERIFIED" },
  VERIFIED: { STORE: "STORED" },
  STORED: { READY: "READY" },
  READY: { ACTIVATE: "ACTIVE" },
  ACTIVE: { RELEASE: "RELEASED" },
  RELEASED: { CLOSE: "CLOSED" },
  CLOSED: {},
};

export type { LifecycleState };