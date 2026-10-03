/**
 * Extraction pipeline — shared contracts.
 *
 * Each source extractor (markdown.ts, text.ts, chatgpt.ts, pdf.ts, folder.ts)
 * is one pure-TypeScript module that deterministically normalizes a raw source
 * into an `ExtractedSource`. The orchestrator (index.ts) turns that into a
 * CAPTURED bucket and runs CAPTURED → VERIFIED → STORED → READY, validating
 * every transition against the lifecycle state machine.
 *
 * Extraction is deterministic normalization ONLY — no AI, no LLM, no
 * embeddings, no vector DB, no summarization, no invented content.
 */

import type { ProvenanceLink } from "../provenance/types";
import type { FullContent, SourceOrigin, SourceType } from "../bucket/types";

/**
 * Result of one extractor run: everything needed to build a CAPTURED bucket
 * (identity, provenance fields, and the normalized full_content payload).
 */
export interface ExtractedSource {
  /** Source name/label (filename, paste label, conversation name…). */
  source: string;
  source_type: SourceType;
  source_origin: SourceOrigin;
  /** Raw input byte size (pre-normalization), for provenance. */
  sizeBytes: number;
  /** Normalized canonical payload. */
  full_content: FullContent;
  /** Original MIME type when known, else null. */
  mime_type?: string | null;
  /** Original source path when known, else null. */
  source_path?: string | null;
  /** Extra provenance hops (e.g. parent folder) — recorded, never invented. */
  source_chain?: ProvenanceLink[];
  /** Short note recorded in the provenance capture context. */
  capture_note?: string;
  /** Non-authoritative, deterministic extras (never source content). */
  metadata?: Record<string, unknown>;
}

/** Configurable ingest limits (defaults in DEFAULT_EXTRACTION_LIMITS). */
export interface ExtractionLimits {
  /** Max bytes of a single text/markdown/chat export source (default 5 MiB). */
  maxSourceBytes?: number;
  /** Max bytes of a single file inside a folder (default 50 MiB). */
  maxFileBytes?: number;
  /** Max number of entries inside a folder (default 2,000). */
  maxFolderEntries?: number;
  /** Max total bytes of one folder (default 250 MiB). */
  maxFolderBytes?: number;
}

export const DEFAULT_EXTRACTION_LIMITS: Required<ExtractionLimits> = {
  maxSourceBytes: 5 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxFolderEntries: 2_000,
  maxFolderBytes: 250 * 1024 * 1024,
};

export type { FullContent, ProvenanceLink, SourceOrigin, SourceType };