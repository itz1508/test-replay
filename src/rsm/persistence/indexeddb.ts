/**
 * IndexedDB repository — V1 persistence boundary implementation.
 *
 * Stores buckets and lifecycle events in separate object stores inside one
 * IndexedDB database (`rsm-store`, see STORE_NAMES). Writes that span both
 * stores (bucket + events) run in a single readwrite transaction so they are
 * atomic: either both land or neither does.
 *
 * Design notes:
 *  - Buckets are stored as their canonical object (structured clone) — no
 *    JSON round-trip, so multi-megabyte folder entry lists and opaque base64
 *    payloads are persisted without a second copy in memory.
 *  - Events live in their own store keyed by event_id with an index on
 *    bucket_id; deletion of a bucket removes its events in the same
 *    transaction via an index cursor (no bulk read needed).
 *  - The only dependency is on the RsmRepository contract (types.ts). Domain
 *    code never imports this module directly.
 *
 * Browser-only. Pure TypeScript, zero React / Vite / Supabase / AI deps.
 */

import { RsmError } from "../errors";
import type { Bucket } from "../bucket/types";
import type { LifecycleEvent } from "../lifecycle/types";
import type { Conversation, Relay } from "../relay/types";
import {
  DEFAULT_DB_NAME,
  DEFAULT_DB_VERSION,
  STORE_NAMES,
  type BucketListFilter,
  type RsmRepository,
} from "./types";

/** Index on the events store: all events for one bucket. */
export const INDEX_EVENTS_BY_BUCKET_ID = "by_bucket_id";

/** Index on the relays store: all relays for one conversation. */
export const INDEX_RELAYS_BY_CONVERSATION_ID = "by_conversation_id";

export interface IndexedDbRepositoryOptions {
  /** Database name. Defaults to DEFAULT_DB_NAME. */
  name?: string;
  /** Schema version. Defaults to DEFAULT_DB_VERSION. */
  version?: number;
  /** Hook run inside onupgradeneeded after the default stores exist. */
  onUpgrade?: (db: IDBDatabase) => void;
}

/** Resolve an IDBRequest to its result, rejecting with its error. */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolve when a readwrite transaction completes (or reject on abort/error). */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

/** Delete every record in `store` whose `indexName` index equals `key`. */
function deleteWhereIndexEquals(
  store: IDBObjectStore,
  indexName: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const index = store.index(indexName);
    const request = index.openCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor == null) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB cursor failed"));
  });
}

function normalizeError(message: string, cause: unknown): RsmError {
  const options: ErrorOptions | undefined = cause instanceof Error ? { cause } : undefined;
  const detail = cause instanceof Error ? ` (${cause.message})` : "";
  return new RsmError("PERSISTENCE_ERROR", `${message}${detail}`, options);
}

function byCreatedDesc(a: Bucket, b: Bucket): number {
  const byTime = b.created_timestamp.localeCompare(a.created_timestamp);
  return byTime !== 0 ? byTime : a.bucket_id.localeCompare(b.bucket_id);
}

function byTimestampAsc(a: LifecycleEvent, b: LifecycleEvent): number {
  const byTime = a.timestamp.localeCompare(b.timestamp);
  return byTime !== 0 ? byTime : a.event_id.localeCompare(b.event_id);
}

function byUpdatedDesc(a: Conversation, b: Conversation): number {
  const byTime = b.updated_at.localeCompare(a.updated_at);
  return byTime !== 0 ? byTime : a.conversation_id.localeCompare(b.conversation_id);
}

function byRelayCreatedDesc(a: Relay, b: Relay): number {
  const byTime = b.created_at.localeCompare(a.created_at);
  return byTime !== 0 ? byTime : a.relay_id.localeCompare(b.relay_id);
}

/**
 * IndexedDB-backed RsmRepository. One instance owns one database connection;
 * call `restore()` once at app start, and `close()` on teardown.
 */
export class IndexedDbRsmRepository implements RsmRepository {
  private readonly dbName: string;
  private readonly dbVersion: number;
  private readonly onUpgrade?: (db: IDBDatabase) => void;

  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbRepositoryOptions = {}) {
    this.dbName = options.name ?? DEFAULT_DB_NAME;
    this.dbVersion = options.version ?? DEFAULT_DB_VERSION;
    this.onUpgrade = options.onUpgrade;
  }

  private idbFactory(): IDBFactory {
    const factory =
      typeof indexedDB !== "undefined" ? indexedDB : (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      throw new RsmError(
        "PERSISTENCE_ERROR",
        "IndexedDB is not available in this environment.",
      );
    }
    return factory;
  }

  /** Open the database (schema created on first run); reused across calls. */
  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;

    const factory = this.idbFactory();
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.dbName, this.dbVersion);
      } catch (err) {
        this.opening = null;
        reject(normalizeError("Failed to open IndexedDB.", err));
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAMES.Buckets)) {
          db.createObjectStore(STORE_NAMES.Buckets, { keyPath: "bucket_id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.Events)) {
          const eventsStore = db.createObjectStore(STORE_NAMES.Events, {
            keyPath: "event_id",
          });
          eventsStore.createIndex(INDEX_EVENTS_BY_BUCKET_ID, "bucket_id", {
            unique: false,
          });
        }
        // V3 (v2 schema): conversations + relays stores.
        if (!db.objectStoreNames.contains(STORE_NAMES.Conversations)) {
          db.createObjectStore(STORE_NAMES.Conversations, { keyPath: "conversation_id" });
        }
        if (!db.objectStoreNames.contains(STORE_NAMES.Relays)) {
          const relaysStore = db.createObjectStore(STORE_NAMES.Relays, {
            keyPath: "relay_id",
          });
          relaysStore.createIndex(INDEX_RELAYS_BY_CONVERSATION_ID, "conversation_id", {
            unique: false,
          });
        }
        this.onUpgrade?.(db);
      };

      request.onsuccess = () => {
        const db = request.result;
        this.db = db;
        this.opening = null;
        // Let other tabs requesting a version upgrade proceed.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        const error = request.error;
        this.opening = null;
        reject(normalizeError("Failed to open IndexedDB.", error));
      };
    });

    return this.opening;
  }

  private async withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.open());
    } catch (err) {
      if (err instanceof RsmError) throw err;
      throw normalizeError("Persistence operation failed.", err);
    }
  }

  async restore(): Promise<void> {
    const db = await this.open();
    if (
      !db.objectStoreNames.contains(STORE_NAMES.Buckets) ||
      !db.objectStoreNames.contains(STORE_NAMES.Events)
    ) {
      throw new RsmError(
        "PERSISTENCE_ERROR",
        "RSM store schema is missing. Open the app once to initialize it.",
      );
    }
  }

  async close(): Promise<void> {
    const db = this.db;
    this.db = null;
    this.opening = null;
    if (db) db.close();
  }

  async saveBucket(bucket: Bucket): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Buckets, "readwrite");
      tx.objectStore(STORE_NAMES.Buckets).put(bucket);
      await transactionDone(tx);
    });
  }

  async saveBucketWithEvents(bucket: Bucket, events: LifecycleEvent[]): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction([STORE_NAMES.Buckets, STORE_NAMES.Events], "readwrite");
      try {
        tx.objectStore(STORE_NAMES.Buckets).put(bucket);
        const eventsStore = tx.objectStore(STORE_NAMES.Events);
        // Atomic replace of the bucket's event log.
        await deleteWhereIndexEquals(eventsStore, INDEX_EVENTS_BY_BUCKET_ID, bucket.bucket_id);
        for (const event of events) {
          eventsStore.put(event);
        }
        await transactionDone(tx);
      } catch (err) {
        tx.abort();
        throw err;
      }
    });
  }

  async appendEvents(bucketId: string, events: LifecycleEvent[]): Promise<void> {
    for (const event of events) {
      if (event.bucket_id !== bucketId) {
        throw new RsmError(
          "VALIDATION_ERROR",
          `Event ${event.event_id} does not belong to bucket ${bucketId}.`,
        );
      }
    }
    await this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Events, "readwrite");
      const store = tx.objectStore(STORE_NAMES.Events);
      for (const event of events) {
        store.put(event);
      }
      await transactionDone(tx);
    });
  }

  async getBucket(bucketId: string): Promise<Bucket | null> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Buckets, "readonly");
      const bucket = await requestResult<Bucket | undefined>(
        tx.objectStore(STORE_NAMES.Buckets).get(bucketId),
      );
      await transactionDone(tx);
      return bucket ?? null;
    });
  }

  async listBuckets(filter?: BucketListFilter): Promise<Bucket[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Buckets, "readonly");
      const buckets = await requestResult<Bucket[]>(
        tx.objectStore(STORE_NAMES.Buckets).getAll(),
      );
      await transactionDone(tx);

      let result = buckets;
      if (filter) {
        if (filter.lifecycle_state !== undefined) {
          result = result.filter((b) => b.lifecycle_state === filter.lifecycle_state);
        }
        if (filter.source_type !== undefined) {
          result = result.filter((b) => b.source_type === filter.source_type);
        }
        if (filter.integrity_status !== undefined) {
          result = result.filter((b) => b.integrity_status === filter.integrity_status);
        }
      }
      return result.sort(byCreatedDesc);
    });
  }

  async getEvents(bucketId: string): Promise<LifecycleEvent[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Events, "readonly");
      const events = await requestResult<LifecycleEvent[]>(
        tx
          .objectStore(STORE_NAMES.Events)
          .index(INDEX_EVENTS_BY_BUCKET_ID)
          .getAll(IDBKeyRange.only(bucketId)),
      );
      await transactionDone(tx);
      return events.sort(byTimestampAsc);
    });
  }

  async deleteBucket(bucketId: string): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction([STORE_NAMES.Buckets, STORE_NAMES.Events], "readwrite");
      try {
        tx.objectStore(STORE_NAMES.Buckets).delete(bucketId);
        await deleteWhereIndexEquals(
          tx.objectStore(STORE_NAMES.Events),
          INDEX_EVENTS_BY_BUCKET_ID,
          bucketId,
        );
        await transactionDone(tx);
      } catch (err) {
        tx.abort();
        throw err;
      }
    });
  }

  // ── V3: conversations & relays ────────────────────────────────────────────

  async getConversation(conversationId: string): Promise<Conversation | null> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Conversations, "readonly");
      const conversation = await requestResult<Conversation | undefined>(
        tx.objectStore(STORE_NAMES.Conversations).get(conversationId),
      );
      await transactionDone(tx);
      return conversation ?? null;
    });
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Conversations, "readwrite");
      tx.objectStore(STORE_NAMES.Conversations).put(conversation);
      await transactionDone(tx);
    });
  }

  async listConversations(): Promise<Conversation[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Conversations, "readonly");
      const conversations = await requestResult<Conversation[]>(
        tx.objectStore(STORE_NAMES.Conversations).getAll(),
      );
      await transactionDone(tx);
      return conversations.sort(byUpdatedDesc);
    });
  }

  async saveRelay(relay: Relay): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Relays, "readwrite");
      tx.objectStore(STORE_NAMES.Relays).put(relay);
      await transactionDone(tx);
    });
  }

  async getRelay(relayId: string): Promise<Relay | null> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Relays, "readonly");
      const relay = await requestResult<Relay | undefined>(
        tx.objectStore(STORE_NAMES.Relays).get(relayId),
      );
      await transactionDone(tx);
      return relay ?? null;
    });
  }

  async listRelaysForConversation(conversationId: string): Promise<Relay[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(STORE_NAMES.Relays, "readonly");
      const relays = await requestResult<Relay[]>(
        tx
          .objectStore(STORE_NAMES.Relays)
          .index(INDEX_RELAYS_BY_CONVERSATION_ID)
          .getAll(IDBKeyRange.only(conversationId)),
      );
      await transactionDone(tx);
      return relays.sort(byRelayCreatedDesc);
    });
  }
}

/** Convenience factory — construct an IndexedDB-backed repository. */
export function createIndexedDbRepository(
  options: IndexedDbRepositoryOptions = {},
): RsmRepository {
  return new IndexedDbRsmRepository(options);
}