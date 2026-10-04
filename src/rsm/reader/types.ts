/**
 * READER — canonical observation trace types.
 *
 * The Reader Trace answers "what has Reader actually observed?" — one
 * continuous Reader operation, expressed as the latest File reached, not one
 * bar per File. The trace is derived from actual Reader state (real content
 * observation), never from a browser timer or invented progress.
 *
 * States required by the boundary contract:
 *   OBSERVED     — full observation completed
 *   PARTIAL      — observation attempted but incomplete (e.g. binary inside a
 *                  textual source, vision-capable material with Vision off)
 *   FAILED       — the FILE failed; the operation continues (failure isolation)
 *   NOT_OBSERVED — not yet reached / not attempted
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { ScanFile } from "../scan/types";

export const TRACE_FILE_STATES = {
  Observed: "OBSERVED",
  Partial: "PARTIAL",
  Failed: "FAILED",
  NotObserved: "NOT_OBSERVED",
} as const;
export type TraceFileState = (typeof TRACE_FILE_STATES)[keyof typeof TRACE_FILE_STATES];

/** Per-file observation record — one entry per scanned File (no per-file bars). */
export interface TraceFileRecord {
  file_id: string;
  state: TraceFileState;
  /** Bytes actually observed by the Reader for this file (0 if none). */
  bytes_observed: number;
  /** Human reason when state !== OBSERVED (never a raw stack trace). */
  note: string | null;
}

/**
 * One continuous Reader operation. `latest` is the latest File reached
 * (1-based across the whole source), NOT a per-file progress component.
 */
export interface ReaderTrace {
  source: string;
  total: number;
  /** Latest file reached during this single continuous operation (0 = none). */
  latest: number;
  /** Running count of files that failed observation (failures stay isolated). */
  failures: number;
  /** Per-file records in scan order (rendered aggregated, not one bar each). */
  files: TraceFileRecord[];
  /** True once the continuous operation has run to the end of the material. */
  finished: boolean;
}

/** Reader capabilities — VISION is a READER capability, not a separate subsystem. */
export interface ReaderCapabilities {
  text: boolean;
  markdown: boolean;
  pdf: boolean;
  tables: boolean;
  images: boolean;
  /** Controlled model-assisted vision when explicitly configured (default off). */
  vision: boolean;
}

/** Default capabilities: deterministic readers on, Vision off unless configured. */
export const DEFAULT_READER_CAPABILITIES: ReaderCapabilities = {
  text: true,
  markdown: true,
  pdf: true,
  tables: false,
  images: false,
  vision: false,
};