/**
 * Canonical serialization for RSM.
 *
 * The canonical JSON format is: deterministic key order (object keys sorted),
 * no whitespace, stable escapes. This makes serialization byte-identical
 * across environments so hashes are stable. Pure TypeScript — no React/Vite/
 * Supabase/AI dependencies.
 */

import { RsmSerializationError } from "../errors";
import type { Bucket, Conversation, FullContent } from "./types";

function assertSerializable(value: unknown, path: string): void {
  if (value === undefined) {
    throw new RsmSerializationError(`Cannot serialize undefined at ${path || "<root>"}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RsmSerializationError(`Cannot serialize non-finite number at ${path || "<root>"}`);
  }
  if (typeof value === "bigint") {
    throw new RsmSerializationError(`Cannot serialize bigint at ${path || "<root>"}`);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new RsmSerializationError(`Cannot serialize ${typeof value} at ${path || "<root>"}`);
  }
}

function stringifyCanonical(value: unknown, path: string): string {
  assertSerializable(value, path);
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item, i) => stringifyCanonical(item, `${path}[${i}]`)).join(",")}]`;
  }
  // Plain object: sort keys deterministically.
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => {
    const child = record[key];
    if (child === undefined) {
      throw new RsmSerializationError(`Cannot serialize undefined member "${key}" at ${path}`);
    }
    return `${JSON.stringify(key)}:${stringifyCanonical(child, path ? `${path}.${key}` : key)}`;
  });
  return `{${parts.join(",")}}`;
}

/**
 * Serialize any JSON-compatible value to canonical JSON:
 * sorted keys, no whitespace.
 */
export function canonicalJson(value: unknown): string {
  return stringifyCanonical(value, "");
}

/** Serialize a bucket to its canonical JSON form (hash-stable). */
export function serializeBucket(bucket: Bucket): string {
  return canonicalJson(bucket);
}

/** Parse canonical JSON back into a Bucket (no validation — see parseBucket). */
export function deserializeBucket(json: string): Bucket {
  return JSON.parse(json) as Bucket;
}

/** Canonical JSON for a folder entry list (used for folder bucket hashing). */
export function serializeFolderEntries(entries: unknown): string {
  return canonicalJson(entries);
}

/** Canonical JSON for a conversation payload. */
export function serializeConversation(conversation: Conversation): string {
  return canonicalJson(conversation);
}

/** Canonical JSON for a full_content envelope. */
export function serializeFullContent(fullContent: FullContent): string {
  return canonicalJson(fullContent);
}

export type { Bucket, Conversation, FullContent };