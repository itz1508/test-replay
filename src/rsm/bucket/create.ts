/**
 * Bucket factory — the single creation path for new RSM buckets.
 *
 * Given source identity, provenance, and full content, this produces a fresh
 * bucket in `CAPTURED` state with integrity `UNVERIFIED` and `hash: null`.
 * Advancing state (VERIFY → STORED → …) belongs to the lifecycle module.
 *
 * Pure TypeScript — no React/Vite/Supabase/AI dependencies.
 */

import type { Hasher } from "../crypto/hash";
import { SCHEMA_VERSION, type Bucket, type FullContent, type SourceOrigin, type SourceType } from "./types";
import type { Provenance } from "../provenance/types";
import { deriveBucketId } from "./identity";

export interface CreateBucketInput {
  /** Source name/label (filename, paste label, chat export id, folder name). */
  source: string;
  source_type: SourceType;
  source_origin: SourceOrigin;
  /** User-supplied intent, optional; never inferred. Defaults to null. */
  intent?: string | null;
  /** Capture provenance, built by provenance/create.ts. */
  provenance: Provenance;
  full_content: FullContent;
  /** Labels applied at ingest. Defaults to []. */
  labels?: string[];
  /** Extra metadata merged into `metadata`. */
  metadata?: Record<string, unknown>;
  /** Override creation timestamp (ISO-8601 UTC); defaults to now. */
  created_timestamp?: string;
  hasher?: Hasher;
}

/**
 * Create a new bucket in CAPTURED state with a deterministic bucket_id
 * and integrity status UNVERIFIED (hash is computed at the VERIFY step).
 */
export async function createBucket(input: CreateBucketInput): Promise<Bucket> {
  const created = input.created_timestamp ?? new Date().toISOString();
  const bucketId = await deriveBucketId(
    {
      source_type: input.source_type,
      source_origin: input.source_origin,
      source: input.source,
    },
    input.hasher,
  );

  return {
    schema_version: SCHEMA_VERSION,
    bucket_id: bucketId,
    source: input.source,
    source_type: input.source_type,
    source_origin: input.source_origin,
    intent: input.intent ?? null,
    lifecycle_state: "CAPTURED",
    created_timestamp: created,
    hash: null,
    integrity_status: "UNVERIFIED",
    provenance: input.provenance,
    full_content: input.full_content,
    optional_summary: null,
    labels: [...(input.labels ?? [])],
    metadata: { ...(input.metadata ?? {}) },
  };
}

export type { Bucket, FullContent, SourceOrigin, SourceType }; // convenience re-exports