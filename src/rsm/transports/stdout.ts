/**
 * stdout transport — human-readable console/serial output of bucket metadata
 * and replay envelope summaries for debugging, logging, and daemon parity.
 *
 * Pure TypeScript; the only environment touch is `console`. No React/Vite deps.
 */

import type { Bucket } from "../bucket/types";
import type { LifecycleEvent } from "../lifecycle/types";
import type { ReplayEnvelope } from "../replay/envelope";

/** Short stable identifier display: first 8 chars of a hex/uuid. */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

/** One-line bucket metadata summary. */
export function logBucketMeta(bucket: Bucket): void {
  const hash = bucket.hash ? shortId(bucket.hash) : "unverified";
  console.info(
    `[rsm] ${bucket.lifecycle_state.padEnd(8)} ${bucket.source_type.padEnd(14)} ` +
      `${shortId(bucket.bucket_id)} "${bucket.source}" hash=${hash} integrity=${bucket.integrity_status}`,
  );
}

/** One-line per-event summary (append-only log reading). */
export function logEvent(event: LifecycleEvent): void {
  console.info(
    `[rsm] ${event.timestamp} ${event.event_type.padEnd(10)} ${event.previous_state} -> ${event.resulting_state} ` +
      `via=${event.initiating_action} actor=${event.actor}${event.reason ? ` — ${event.reason}` : ""}`,
  );
}

/** Summary line for a replay envelope (never dumps full content to stdout). */
export function logEnvelope(envelope: ReplayEnvelope): void {
  console.info(
    `[rsm] replay ${shortId(envelope.replay_id)} created=${envelope.created_at} ` +
      `buckets=${envelope.buckets.length} states=[${envelope.states.join(",")}] ` +
      `envelope_hash=${shortId(envelope.envelope_hash)}`,
  );
}