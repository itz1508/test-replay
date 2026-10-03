/**
 * Bucket identity — deterministic, stable identity derived from source identity.
 *
 * `bucket_id` is a deterministic UUID-shaped string derived from the source
 * identity triple (source_type, source_origin, source label). Re-capturing the
 * same source produces the same bucket_id — this is RSM's deduplication key.
 * Identity is computed BEFORE any content hash exists (hash is set at VERIFY).
 *
 * Pure TypeScript. No React/Vite/Supabase/AI dependencies.
 */

import type { Hasher } from "../crypto/hash";
import { getDefaultHasher } from "../crypto/hash";
import type { Bucket, SourceOrigin, SourceType } from "./types";

export interface SourceIdentity {
  source_type: SourceType;
  source_origin: SourceOrigin;
  /** Source name/label (filename, paste label, chat export id, folder name). */
  source: string;
}

/** String used as domain separation for identity derivation. */
export const RSM_IDENTITY_NAMESPACE = "rsm/bucket/v1";

/** Canonical source-identity string → deterministic, fixed key order, no whitespace. */
export function canonicalIdentityString(identity: SourceIdentity): string {
  return JSON.stringify({
    source_type: identity.source_type,
    source_origin: identity.source_origin,
    source: identity.source,
  });
}

/**
 * Derive a deterministic bucket_id (UUID-shaped, v5-like) from source identity.
 * Uses SHA-256 of the canonical identity string; first 16 bytes laid out as a
 * UUID with version/variant bits set, so the result is a valid UUID string.
 */
export async function deriveBucketId(identity: SourceIdentity, hasher: Hasher = getDefaultHasher()): Promise<string> {
  const digestHex = await hasher.sha256Hex(canonicalIdentityString(identity));
  const hex = digestHex.slice(0, 32);
  // Set version (nibble 12) to 5 and variant (nibble 16) to 8 (RFC variant).
  const withVersion = `${hex.slice(0, 12)}5${hex.slice(13, 16)}8${hex.slice(17)}`;
  return `${withVersion.slice(0, 8)}-${withVersion.slice(8, 12)}-${withVersion.slice(12, 16)}-${withVersion.slice(16, 20)}-${withVersion.slice(20)}`;
}

/** Source identity extracted from an existing bucket (used for dedup checks). */
export function identityOfBucket(bucket: Bucket): SourceIdentity {
  return {
    source_type: bucket.source_type,
    source_origin: bucket.source_origin,
    source: bucket.source,
  };
}

/** Deduplication key: the canonical identity string of a bucket. */
export function dedupeKeyOf(bucket: Bucket): string {
  return canonicalIdentityString(identityOfBucket(bucket));
}