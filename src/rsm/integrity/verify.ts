/**
 * Integrity verification against a stored bucket fingerprint.
 *
 * Pure TypeScript — zero React/Vite/Supabase/AI dependencies.
 */

import type { Hasher } from "../crypto/hash";
import { assessIntegrity, computeContentHash } from "./hash";
import type { Bucket, IntegrityStatus } from "../bucket/types";

export interface BucketIntegrityResult {
  /** Computed SHA-256 of the bucket's current canonical content. */
  computedHash: string;
  /** Resulting integrity status (VALID | INVALID | UNVERIFIED). */
  status: IntegrityStatus;
  /** True when a stored fingerprint exists and no longer matches. */
  mismatch: boolean;
  /** Short human-readable reason for the status. */
  reason: string;
}

/**
 * Compute the content hash for a bucket and assess it against the bucket's
 * stored fingerprint. Read-only — never mutates the bucket.
 */
export async function verifyBucketIntegrity(
  bucket: Bucket,
  hasher: Hasher | undefined = undefined,
): Promise<BucketIntegrityResult> {
  const computed = await computeContentHash(bucket.full_content, hasher);
  const status = await assessIntegrity(bucket.full_content, bucket.hash, hasher);
  return {
    computedHash: computed,
    status,
    mismatch: status === "INVALID",
    reason:
      status === "INVALID"
        ? "Stored fingerprint does not match the current content. Content was mutated or the fingerprint is stale; RSM does not silently rewrite."
        : status === "UNVERIFIED"
          ? "No fingerprint recorded yet; run the VERIFY step to bind one."
          : "Fingerprint matches the current content.",
  };
}

export interface VerifyResult {
  /** New bucket with hash + integrity_status updated (caller persists). */
  bucket: Bucket;
  /** The hash that was computed/bound by this verification. */
  computedHash: string;
  /** Short human-readable reason for the resulting status. */
  reason: string;
}

/**
 * The VERIFY lifecycle step.
 * - CAPTURED bucket: binds the initial fingerprint and sets integrity VALID.
 * - Later states: re-checks content against the stored fingerprint without
 *   changing lifecycle_state. A mismatch is reported as INVALID — the content
 *   is never silently rewritten.
 * Returns a new Bucket with hash + integrity_status updated; caller persists.
 */
export async function verifyBucket(bucket: Bucket, hasher?: Hasher): Promise<VerifyResult> {
  const computed = await computeContentHash(bucket.full_content, hasher);
  const status = await assessIntegrity(bucket.full_content, bucket.hash, hasher);
  const updated: Bucket = {
    ...bucket,
    hash: bucket.hash ?? computed,
    integrity_status: status === "UNVERIFIED" ? "VALID" : status,
  };
  return {
    bucket: updated,
    computedHash: computed,
    reason:
      status === "UNVERIFIED"
        ? `Integrity fingerprint bound: ${computed.slice(0, 12)}…`
        : status === "VALID"
          ? "Integrity re-verified: fingerprint matches current content."
          : "Integrity check failed: content no longer matches the stored fingerprint.",
  };
}