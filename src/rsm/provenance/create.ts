/**
 * Provenance factory helpers. Deterministic, environment-agnostic.
 */

import type { SourceType } from "../bucket/types";
import type { CaptureContext, Provenance, ProvenanceEvent, ProvenanceLink } from "./types";

export interface CreateProvenanceInput {
  /** Canonical source label (filename, paste label, folder name, chat export id). */
  origin: string;
  /** Ingestion method: "paste" | "file_upload" | "folder_ingest" | "chatgpt_export" | ... */
  ingestion_method: string;
  sourceName: string;
  sourcePath?: string | null;
  sourceType: SourceType;
  /** ISO-8601 UTC capture timestamp; defaults to now. */
  capturedAt?: string;
  mimeType?: string | null;
  sizeBytes: number;
  sourceChain?: ProvenanceLink[];
  captureContext?: Partial<CaptureContext>;
}

/** Build the provenance record for a fresh capture. */
export function createProvenance(input: CreateProvenanceInput): Provenance {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const captureContext: CaptureContext = {
    environment: input.captureContext?.environment ?? "browser",
    tool: input.captureContext?.tool ?? "rsm-core",
    ...(input.captureContext?.note !== undefined ? { note: input.captureContext.note } : {}),
  };
  return {
    origin: input.origin,
    ingestion_method: input.ingestion_method,
    source_name: input.sourceName,
    source_path: input.sourcePath ?? null,
    source_type: input.sourceType,
    captured_at: capturedAt,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes,
    source_chain: input.sourceChain ?? [],
    capture_context: captureContext,
    event_trail: [
      {
        event_type: "RSM_CAPTURE",
        timestamp: capturedAt,
        detail: `Captured via ${input.ingestion_method}`,
      },
    ],
  };
}

/** Returns a new Provenance with a capture event appended (immutable, append-only). */
export function recordProvenanceEvent(
  provenance: Provenance,
  eventType: string,
  detail: string,
  at = new Date().toISOString(),
): Provenance {
  const event: ProvenanceEvent = { event_type: eventType, timestamp: at, detail };
  return { ...provenance, event_trail: [...provenance.event_trail, event] };
}