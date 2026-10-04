/**
 * READER — actual content observation, failure-isolated, with a single
 * continuous trace.
 *
 * The Reader reads the already-stored canonical content to produce an
 * observation trace. Failure isolation is enforced per file: one file failure
 * never terminates the whole operation. The trace is a single continuous value
 * (`latest` = latest file reached), never a set of per-file bars.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { Bucket } from "../bucket/types";
import type { ScanFile, ScanResult } from "../scan/types";
import {
  DEFAULT_READER_CAPABILITIES,
  TRACE_FILE_STATES,
  type ReaderCapabilities,
  type ReaderTrace,
  type TraceFileRecord,
  type TraceFileState,
} from "./types";

/** Create an empty trace for the given scan (all files NOT_OBSERVED). */
export function initTrace(scan: ScanResult): ReaderTrace {
  return {
    source: scan.source,
    total: scan.files.length,
    latest: 0,
    failures: 0,
    files: scan.files.map((f) => ({
      file_id: f.file_id,
      state: TRACE_FILE_STATES.NotObserved as TraceFileState,
      bytes_observed: 0,
      note: null,
    })),
    finished: false,
  };
}

/** Update a trace after observing one file (pure reducer — returns new trace). */
export function recordObservation(
  trace: ReaderTrace,
  fileIndex: number,
  state: TraceFileState,
  bytesObserved: number,
  note: string | null = null,
): ReaderTrace {
  const files = [...trace.files];
  files[fileIndex] = { file_id: files[fileIndex].file_id, state, bytes_observed: bytesObserved, note };
  return {
    ...trace,
    files,
    latest: Math.min(trace.total, Math.max(trace.latest, fileIndex + 1)),
    failures: trace.failures + (state === TRACE_FILE_STATES.Failed ? 1 : 0),
    finished: fileIndex + 1 >= trace.total,
  };
}

/**
 * Observe a scanned source, file by file. Each file is read from the bucket's
 * stored content — progress is derived from real data, never simulated.
 *
 * - Text files (text/markdown/pasted_text): OBSERVED with full byte count.
 * - Conversation files: OBSERVED with serialised-JSON byte count.
 * - Folder entries with opaque content: PARTIAL (binary/opaque; no Vision
 *   configured).
 * - Opaque buckets: NOT_OBSERVED.
 * - Any thrown error: FAILED, operation continues (failure isolation).
 *
 * Returns a generator that yields the updated trace after each file, so the
 * UI or consumer can render the one-bar progression without inventing steps.
 */
export function* observeSource(
  bucket: Bucket,
  scan: ScanResult,
  _caps: ReaderCapabilities = DEFAULT_READER_CAPABILITIES,
): Generator<ReaderTrace> {
  let trace = initTrace(scan);
  const caps = { ...DEFAULT_READER_CAPABILITIES, ..._caps };

  for (let i = 0; i < scan.files.length; i++) {
    const file = scan.files[i];
    try {
      const result = readFileContent(bucket, file, caps);
      trace = recordObservation(trace, i, result.state, result.bytes, result.note);
    } catch {
      trace = recordObservation(trace, i, TRACE_FILE_STATES.Failed as TraceFileState, 0, "Reader encountered an error.");
    }
    yield trace;
  }
}

/* ------------------------------------------------------------------ */
/*  Internal — per-file content reading                                */
/* ------------------------------------------------------------------ */

interface ReadFileResult {
  state: TraceFileState;
  bytes: number;
  note: string | null;
}

function readFileContent(bucket: Bucket, file: ScanFile, caps: ReaderCapabilities): ReadFileResult {
  if (bucket.full_content.kind === "folder") {
    const entry = bucket.full_content.entries.find((e) => e.relative_path === file.relative_path);
    if (!entry) return { state: TRACE_FILE_STATES.Failed as TraceFileState, bytes: 0, note: "Entry not found." };
    if (entry.content.kind === "text") {
      const bytes = new TextEncoder().encode(entry.content.text).length;
      return { state: TRACE_FILE_STATES.Observed as TraceFileState, bytes, note: null };
    }
    if (caps.vision) {
      // Vision capability declared — observation attempted, content is opaque.
      const bytes = entry.content.bytes
        ? new TextEncoder().encode(entry.content.bytes).length
        : 0;
      return { state: TRACE_FILE_STATES.Partial as TraceFileState, bytes, note: "Opaque content — vision configured but content is binary." };
    }
    return { state: TRACE_FILE_STATES.Observed as TraceFileState, bytes: entry.size_bytes, note: "Opaque content observed at boundary (size only)." };
  }

  // Whole-source bucket: single file.
  const content = bucket.full_content;
  switch (content.kind) {
    case "text": {
      const bytes = new TextEncoder().encode(content.text).length;
      return { state: TRACE_FILE_STATES.Observed as TraceFileState, bytes, note: null };
    }
    case "conversation": {
      const bytes = new TextEncoder().encode(JSON.stringify(content.conversation)).length;
      return { state: TRACE_FILE_STATES.Observed as TraceFileState, bytes, note: null };
    }
    case "folder": {
      // Handled above — fallthrough
    }
    // fall through
    default: {
      if (content.kind === "opaque" && caps.vision) {
        const bytes = content.bytes ? new TextEncoder().encode(content.bytes).length : 0;
        return { state: TRACE_FILE_STATES.Partial as TraceFileState, bytes, note: "Opaque content — Vision attempted but content is binary." };
      }
      return { state: TRACE_FILE_STATES.NotObserved as TraceFileState, bytes: 0, note: "Opaque content — no Reader capability available." };
    }
  }
}