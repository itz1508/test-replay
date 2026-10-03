/**
 * Portable SHA-256 hashing abstraction.
 *
 * RSM runs in the browser today (Vite shell) and in Node.js environments in
 * the future (daemon companion tooling). Both runtimes expose the Web Crypto
 * `crypto.subtle` API, so we use a single thin adapter instead of binding to
 * any environment-specific API. No React/Vite/Supabase/AI dependencies.
 */

import { RsmError } from "../errors";

export interface Hasher {
  /**
   * Compute the SHA-256 digest of `input` and return it as a lowercase hex
   * string (64 characters).
   */
  sha256Hex(input: string | Uint8Array): Promise<string>;
}

function getSubtle(): SubtleCrypto {
  const cryptoImpl = globalThis.crypto;
  if (!cryptoImpl || typeof cryptoImpl.subtle !== "object" || cryptoImpl.subtle === null) {
    throw new RsmError(
      "CRYPTO_UNAVAILABLE",
      "Web Crypto (crypto.subtle) is not available in this runtime; RSM integrity and identity require SHA-256.",
    );
  }
  return cryptoImpl.subtle;
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new TextEncoder().encode(input);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export class WebCryptoHasher implements Hasher {
  async sha256Hex(input: string | Uint8Array): Promise<string> {
    const subtle = getSubtle();
    const digest = await subtle.digest("SHA-256", toBytes(input) as BufferSource);
    return bytesToHex(new Uint8Array(digest));
  }
}

let defaultHasher: Hasher | null = null;

/**
 * Returns a shared hasher instance. Pure domain code should accept a Hasher
 * as a dependency where convenient, but may use this default when simplicity
 * wins (e.g. serialization helpers).
 */
export function getDefaultHasher(): Hasher {
  if (defaultHasher === null) {
    defaultHasher = new WebCryptoHasher();
  }
  return defaultHasher;
}

/** RFC-4122-shaped random UUID (v4) for event ids, replay ids, etc. */
export function randomUuid(): string {
  const cryptoImpl = globalThis.crypto;
  if (cryptoImpl && typeof cryptoImpl.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new RsmError("CRYPTO_UNAVAILABLE", "No random UUID source available in this runtime.");
}

/** Encode plain UTF-8 bytes (used for canonical hashing to guarantee byte-level stability). */
export function utf8Bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}