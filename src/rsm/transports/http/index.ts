/**
 * HTTP transport — BOUNDARY SPEC ONLY.
 *
 * This module defines the TypeScript contract that a future HTTP daemon (the
 * Python companion) implements. There is intentionally NO implementation code
 * here: the contracts are the handshake, and the daemon owns the transport.
 *
 * RSM domain code never calls HTTP directly — the UI shell talks to the
 * repository; the daemon serves the same domain through these endpoints.
 *
 * Expected daemon surface (v1):
 *   GET  /health                          → { status: "ok", schema_version }
 *   GET  /buckets[?state=&source_type=]    → { buckets: Bucket[] }  (newest first)
 *   GET  /buckets/:id                      → { bucket: Bucket, events: LifecycleEvent[] }
 *   POST /buckets/:id/transition           → body { action, reason? } → { bucket, event }
 *   POST /replay                           → ReplayEnvelope
 *   GET  /export/buckets                   → canonical JSON document (download)
 *   GET  /export/replay/:replay_id         → ReplayEnvelope canonical JSON
 */

import type { Bucket, LifecycleState, SourceType } from "../../bucket/types";
import type { LifecycleAction, LifecycleEvent } from "../../lifecycle/types";
import type { ReplayEnvelope } from "../../replay/index";

/** Wire-friendly filter query (mirrors BucketListFilter, URL-encoded). */
export interface HttpListQuery {
  state?: LifecycleState;
  source_type?: SourceType;
  limit?: number;
}

/** Standard envelope for all daemon JSON responses. */
export interface RsmHttpResponse<T> {
  ok: boolean;
  data?: T;
  /** Machine-readable error code when not ok (RSM error code vocabulary). */
  error?: string;
  /** Human-readable error message when not ok. */
  message?: string;
}

export interface HttpBucketDetail {
  bucket: Bucket;
  events: LifecycleEvent[];
}

export interface HttpTransitionBody {
  action: LifecycleAction;
  /** Optional event reason (never raw user content). */
  reason?: string;
}

export interface HttpTransitionResult {
  bucket: Bucket;
  event: LifecycleEvent;
}

/**
 * The HTTP daemon must implement this surface. Versioned so the Python daemon
 * pins against a stable contract.
 */
export interface RsmHttpTransport {
  readonly version: 1;
  health(): Promise<RsmHttpResponse<{ status: "ok"; schema_version: string }>>;
  listBuckets(query?: HttpListQuery): Promise<RsmHttpResponse<{ buckets: Bucket[] }>>;
  getBucket(bucketId: string): Promise<RsmHttpResponse<HttpBucketDetail>>;
  transition(bucketId: string, body: HttpTransitionBody): Promise<RsmHttpResponse<HttpTransitionResult>>;
  createReplay(): Promise<RsmHttpResponse<ReplayEnvelope>>;
}