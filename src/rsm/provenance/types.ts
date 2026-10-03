/**
 * Provenance model — the record of *how* a bucket came to exist.
 *
 * Provenance is part of the RSM domain and is persisted with every bucket.
 * It describes the source identity (name, path, type, origin), how the
 * content was captured, when, and the trail of capture-related events.
 * RSM never fabricates provenance; every node is recorded at ingest time.
 */

import type { SourceType } from "../bucket/types";

/** One hop in a source chain (e.g. an uploaded file → its parent folder). */
export interface ProvenanceLink {
  /** Human-readable label of the hop, e.g. "parent folder entry". */
  label: string;
  /** Stable identity of the hop, e.g. a file's own hash or id. */
  detail: string;
  /** ISO-8601 UTC timestamp of the hop. */
  at: string;
}

/** Environment/context in which capture occurred. */
export interface CaptureContext {
  /** Execution environment: "browser" (current V1) or future daemon runtimes. */
  environment: string;
  /** Tool that performed the capture, e.g. "rsm-web-app-v1". */
  tool: string;
  /** Free-form note (never user content; e.g. capture method detail). */
  note?: string;
}

/** An immutable, append-only capture event. */
export interface ProvenanceEvent {
  /** Canonical event type, e.g. "RSM_CAPTURE". */
  event_type: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Short human-readable detail. */
  detail: string;
}

export interface Provenance {
  /** Where the material came from: paste label, filename, export name, etc. */
  origin: string;
  /** How it was captured, e.g. "paste", "file_upload", "folder_ingest", "chatgpt_export". */
  ingestion_method: string;
  /** Original source name/label. */
  source_name: string;
  /** Original source path when known (file or folder entry), else null. */
  source_path: string | null;
  /** Canonical source type of the bucket. */
  source_type: SourceType;
  /** ISO-8601 UTC capture timestamp. */
  captured_at: string;
  /** MIME type when known, else null. */
  mime_type: string | null;
  /** Size of the captured raw input in bytes. */
  size_bytes: number;
  /** Ordered source chain (empty array is valid for direct paste/upload). */
  source_chain: ProvenanceLink[];
  /** Fixed capture context. */
  capture_context: CaptureContext;
  /** Append-only capture event trail. */
  event_trail: ProvenanceEvent[];
}