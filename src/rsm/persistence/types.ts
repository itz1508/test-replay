/**
 * RSM persistence boundary — repository contract.
 *
 * The repository interface is the ONLY persistence surface that RSM domain
 * code (bucket, lifecycle, integrity, extraction) may use. Domain modules
 * never touch IndexedDB, localStorage, files, or any transport directly —
 * they call this interface, and the concrete implementation is injected.
 *
 * In V1 the concrete implementation is IndexedDB (browser-only, local-first).
 * In the future a daemon-owned store can replace this implementation behind
 * the same interface — nothing in the domain changes.
 *
 * Pure TypeScript — zero React / Vite / Supabase / AI dependencies.
 */

import type { Bucket, IntegrityStatus, LifecycleState, SourceType } from "../bucket/types";
import type { LifecycleEvent } from "../lifecycle/types";
import type { Conversation, Relay } from "../relay/types";

/** Default IndexedDB database name for the RSM store. */
export const DEFAULT_DB_NAME = "rsm-store";

/** Default schema version — bump + provide migration logic when stores change. */
export const DEFAULT_DB_VERSION = 2;

/** Physical object stores inside the IndexedDB database. */
export const STORE_NAMES = {
  Buckets: "buckets",
  Events: "events",
  Conversations: "conversations",
  Relays: "relays",
} as const;

/** Optionally widen the filter set over time without breaking the contract. */
export interface BucketListFilter {
  /** Narrow to a single lifecycle state, e.g. "READY". */
  lifecycle_state?: LifecycleState;
  /** Narrow to a single source type, e.g. "markdown". */
  source_type?: SourceType;
  /** Narrow to a single integrity status, e.g. "VALID". */
  integrity_status?: IntegrityStatus;
}

/**
 * RSM-owned repository contract.
 *
 * All operations are async and isolated; callers never see the backing
 * storage technology. Implementations must:
 *  - persist buckets and lifecycle events durably,
 *  - treat `saveBucketWithEvents` / `deleteBucket` as atomic units,
 *  - reject with an RsmError (`PERSISTENCE_ERROR`) when storage fails,
 *  - tolerate large payloads (folder entry lists, opaque binaries, PDFs).
 */
export interface RsmRepository {
  /** Persist a bucket (create or full overwrite of that bucket_id). */
  saveBucket(bucket: Bucket): Promise<void>;

  /**
   * Persist a bucket AND its full event log in a single atomic write.
   * Replaces any previously stored events for the bucket (idempotent save).
   */
  saveBucketWithEvents(bucket: Bucket, events: LifecycleEvent[]): Promise<void>;

  /** Append events to an existing bucket's immutable, append-only log. */
  appendEvents(bucketId: string, events: LifecycleEvent[]): Promise<void>;

  /** Fetch one bucket by id, or null when absent. */
  getBucket(bucketId: string): Promise<Bucket | null>;

  /** List buckets (optionally filtered). Order: newest created first. */
  listBuckets(filter?: BucketListFilter): Promise<Bucket[]>;

  /** Read the append-only event log for a bucket, oldest first. */
  getEvents(bucketId: string): Promise<LifecycleEvent[]>;

  /** Delete a bucket and all of its events atomically (idempotent). */
  deleteBucket(bucketId: string): Promise<void>;

  // ── V3: conversations & relays ────────────────────────────────────────────

  /** Fetch one conversation by id, or null when absent. */
  getConversation(conversationId: string): Promise<Conversation | null>;

  /** Create a conversation (defaults to RSM OFF) or overwrite an existing one. */
  saveConversation(conversation: Conversation): Promise<void>;

  /** List conversations, newest updated first. */
  listConversations(): Promise<Conversation[]>;

  /** Persist a relay (create or overwrite). */
  saveRelay(relay: Relay): Promise<void>;

  /** Fetch one relay by id, or null when absent. */
  getRelay(relayId: string): Promise<Relay | null>;

  /** List relays for one conversation, newest created first. */
  listRelaysForConversation(conversationId: string): Promise<Relay[]>;

  /**
   * Reload authoritative state from persistence on app start.
   * Resolves once the store is open and the schema is present; the caller
   * then pulls data via listBuckets / getBucket / getEvents.
   */
  restore(): Promise<void>;

  /** Release the underlying connection (app teardown / tests). */
  close(): Promise<void>;
}