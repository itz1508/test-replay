/**
 * Integrity module — SHA-256 fingerprinting of bucket content.
 *
 * RSM's integrity contract (PRD §Integrity rules):
 * - The stored `bucket.hash` is the SHA-256 of the bucket's *canonical content
 *   bytes* — NOT of the whole envelope (lifecycle metadata legitimately
 *   changes; content must not).
 * - text:        UTF-8 bytes of the normalized text content.
 * - folder:      UTF-8 bytes of the canonical JSON serialization of the
 *                ordered entry list.
 * - conversation: UTF-8 bytes of the canonical JSON of the conversation.
 * - opaque:      the raw bytes (base64-decoded at verification time).
 *
 * Pure TypeScript. Zero imports from React, Vite, browser UI, Supabase, or AI
 * libraries. Hashes are computed via the portable Hasher (Web Crypto).
 */

import type { Hasher } from "../crypto/hash";
import { getDefaultHasher } from "../crypto/hash";
import { RsmError } from "../errors";
import { serializeConversation, serializeFullContent } from "../bucket/serialization";
import type { FullContent } from "../bucket/types";

/** Port of the browser/Node `atob` (pure TS, environment-agnostic). */
function base64ToBytes(base64: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/=+$/, "").replace(/\s+/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new RsmError("VALIDATION_ERROR", "Invalid base64 character in opaque content.");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * SHA-256 hex fingerprint of the canonical content bytes of a bucket.
 * Determines which serialization rule applies per content kind.
 */
export async function computeContentHash(fullContent: FullContent, hasher: Hasher = getDefaultHasher()): Promise<string> {
  switch (fullContent.kind) {
    case "text":
      return hasher.sha256Hex(fullContent.text);
    case "conversation":
      return hasher.sha256Hex(serializeConversation(fullContent.conversation));
    case "folder":
      // Canonical JSON of the whole folder content — sorted keys, no whitespace.
      return hasher.sha256Hex(serializeFullContent(fullContent));
    case "opaque":
      return hasher.sha256Hex(base64ToBytes(fullContent.bytes));
    default: {
      // Exhaustiveness guard: FullContent is a closed union.
      const _exhaustive: never = fullContent;
      return _exhaustive;
    }
  }
}

/**
 * Assess the integrity status of bucket content against its stored
 * fingerprint, without mutating anything.
 *
 * - "VALID"      — stored hash is present and matches the recomputed content hash.
 * - "INVALID"    — stored hash is present but content no longer matches
 *                  (content mutated or fingerprint tampered). RSM never
 *                  silently rewrites a mismatched bucket.
 * - "UNVERIFIED" — no stored hash yet (bucket still in CAPTURED / pre-VERIFY).
 */
export async function assessIntegrity(
  fullContent: FullContent,
  storedHash: string | null,
  hasher: Hasher = getDefaultHasher(),
): Promise<"VALID" | "INVALID" | "UNVERIFIED"> {
  if (storedHash === null || storedHash === "") return "UNVERIFIED";
  const computed = await computeContentHash(fullContent, hasher);
  return computed === storedHash ? "VALID" : "INVALID";
}