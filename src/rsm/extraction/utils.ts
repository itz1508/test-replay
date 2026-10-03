/**
 * Extraction helpers — pure UTF-8 / base64 conversion utilities.
 *
 * Environment-agnostic (browser + Node). No React/Vite/Supabase/AI deps.
 */

import { RsmError } from "../errors";

/** Encode bytes as standard base64 (pure TS, no Buffer dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : "=";
  }
  return out;
}

/** UTF-8 byte length of a string (TextEncoder is available in browser + Node). */
export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}

/**
 * Strict UTF-8 decode. Throws VALIDATION_ERROR for invalid UTF-8 so callers
 * fall back to an opaque entry rather than misrepresenting binary as text.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RsmError("VALIDATION_ERROR", "Content is not valid UTF-8; it must be stored as an opaque entry, never as text.");
  }
}