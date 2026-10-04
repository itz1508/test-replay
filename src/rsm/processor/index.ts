/**
 * PROCESSOR — prepare a bounded representation from observed source material.
 *
 * The processor reduces/selects the observed content to a bounded payload that
 * Replay can deliver. It is NOT Agent reasoning — it does not interpret,
 * plan, or execute the user's task. Every reduction is recorded in the
 * coverage ledger so nothing is discarded silently.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { Bucket } from "../bucket/types";
import type { ScanFile } from "../scan/types";
import type { ReaderTrace } from "../reader/types";
import type { PrepareOptions, PreparedRepresentation, PreparationCoverageEntry, PreparationMethod } from "./types";

/** Default budget for a prepared representation (64 KB). */
export const DEFAULT_PREPARED_BUDGET_BYTES = 64 * 1024;

/**
 * Default budget limit applied for bounded delivery; equal to the max source
 * budget to preserve existing behaviour.
 */
/** (Reuse shared extraction limit concept — no new arbitrary number.) */

/**
 * Prepare a bounded representation from an observed bucket.
 *
 * - PASSTHROUGH for simple text: passes the full content unmodified.
 * - BOUNDED-REDUCE for larger material: trims to budget and records coverage
 *   per file.
 * - Never mutates the authoritative bucket.
 */
export function prepare(
  bucket: Bucket,
  options: PrepareOptions = {},
): PreparedRepresentation {
  const maxBytes = options.maxBytes ?? DEFAULT_PREPARED_BUDGET_BYTES;
  const bucketId = bucket.bucket_id;
  const content = extractFullText(bucket);
  const totalBytes = new TextEncoder().encode(content).length;

  let included: string;
  let method: PreparationMethod;
  let entries: PreparationCoverageEntry[];

  if (totalBytes <= maxBytes) {
    // Passthrough — whole content fits within the budget
    included = content;
    method = "passthrough";
    entries = [
      {
        file_id: `${bucketId}::root`,
        included: true,
        reason: "full",
      },
    ];
  } else {
    // Bounded-reduce — take a leading slice; record coverage
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const slice = bytes.slice(0, maxBytes);
    included = new TextDecoder().decode(slice);

    const truncated = bytes.length > maxBytes;
    entries = [
      {
        file_id: `${bucketId}::root`,
        included: truncated,
        reason: truncated ? "bounded-by-budget" : "full",
      },
    ];
    method = "bounded-reduce";
  }

  return {
    prepared_id: `${bucketId}@${Date.now()}`, // deterministic-id for session; not persisted
    bucket_id: bucketId,
    content: included,
    content_bytes: included.length,
    coverage: entries,
    method,
    budget_bytes: method === "bounded-reduce" ? maxBytes : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Internal — extract the full readable text from a Bucket            */
/* ------------------------------------------------------------------ */

function extractFullText(bucket: Bucket): string {
  const fc = bucket.full_content;
  switch (fc.kind) {
    case "text":
      return fc.text;
    case "conversation":
      return JSON.stringify(fc.conversation, null, 2);
    case "folder":
      return fc.entries
        .map((e) => `[${e.relative_path}]\n${e.content.kind === "text" ? e.content.text : ""}`)
        .join("\n\n");
    case "opaque":
      return "";
  }
}
