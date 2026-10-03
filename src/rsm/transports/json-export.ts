/**
 * JSON export transport — canonical JSON export of buckets and replay envelopes.
 *
 * Pure functions only: each returns a suggested filename + the canonical JSON
 * string, with NO DOM/file-system dependency. The UI shell owns turning the
 * string into a downloadable blob (see the `downloadText` helper in the UI).
 *
 * Pure TypeScript — no React/Vite/Supabase/AI imports.
 */

import { canonicalJson, serializeBucket } from "../bucket/serialization";
import { SCHEMA_VERSION, type Bucket } from "../bucket/types";
import type { ReplayEnvelope } from "../replay/envelope";

export interface JsonExport {
  /** Suggested filename for the export. */
  filename: string;
  /** Canonical JSON (sorted keys, no whitespace). */
  json: string;
}

/** Make a stable, filesystem-friendly filename from a bucket source label. */
export function slugifySource(source: string, max = 60): string {
  const slug = source
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || "untitled";
}

/** Suggested filename for a single bucket export. */
export function bucketExportFilename(bucket: Bucket): string {
  return `rsm-${slugifySource(bucket.source)}-${bucket.bucket_id.slice(0, 8)}.json`;
}

/** Serialize a single bucket to canonical JSON (hash-stable form). */
export function bucketToJson(bucket: Bucket): string {
  return serializeBucket(bucket);
}

/** Wrap one bucket into a standalone export document. */
export function exportBucket(bucket: Bucket): JsonExport {
  return {
    filename: bucketExportFilename(bucket),
    json: serializeBucket(bucket),
  };
}

/** Export multiple buckets as a single canonical document. */
export function exportBuckets(buckets: Bucket[], exportedAt: string = new Date().toISOString()): JsonExport {
  const payload = {
    schema_version: SCHEMA_VERSION,
    kind: "rsm.buckets.v1",
    exported_at: exportedAt,
    count: buckets.length,
    buckets,
  };
  return {
    filename: `rsm-export-${exportedAt.slice(0, 10)}-${buckets.length}-buckets.json`,
    json: canonicalJson(payload),
  };
}

/** Serialize a replay envelope to canonical JSON. */
export function exportEnvelope(envelope: ReplayEnvelope): JsonExport {
  return {
    filename: `rsm-replay-${envelope.replay_id.slice(0, 8)}.json`,
    json: canonicalJson(envelope),
  };
}

export type { ReplayEnvelope };