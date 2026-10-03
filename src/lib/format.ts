/** Small UI formatting helpers (display only — never enters the domain). */

import type { IntegrityStatus, LifecycleState } from "../rsm/bucket/types";

export function shortId(id: string | null | undefined, keep = 8): string {
  if (!id) return "—";
  return id.length <= keep + 1 ? id : `${id.slice(0, keep)}…`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Stable CSS/semantic class color per lifecycle state. */
export type Tone = "primary" | "info" | "success" | "warning" | "muted" | "destructive";

/**
 * Exhaustive map keyed by the domain union: adding a lifecycle state to
 * LIFECYCLE_STATES is a compile error here until it gets a tone, instead of
 * silently rendering as "muted".
 */
const LIFECYCLE_TONES: Record<LifecycleState, Tone> = {
  CAPTURED: "muted",
  VERIFIED: "info",
  STORED: "info",
  READY: "success",
  ACTIVE: "primary",
  RELEASED: "primary",
  CLOSED: "muted",
};

const INTEGRITY_TONES: Record<IntegrityStatus, Tone> = {
  VALID: "success",
  INVALID: "destructive",
  UNVERIFIED: "muted",
};

/**
 * Stored buckets come from IndexedDB, so a value written by an older schema can
 * reach the UI; fall back rather than render `undefined` classes.
 */
export function lifecycleStateTone(state: LifecycleState): Tone {
  return LIFECYCLE_TONES[state] ?? "muted";
}

export function integrityTone(status: IntegrityStatus): Tone {
  return INTEGRITY_TONES[status] ?? "muted";
}