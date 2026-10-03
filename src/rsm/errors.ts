/**
 * RSM domain error types.
 *
 * The RSM domain (`src/rsm/`) is pure TypeScript. It has zero imports from
 * React, Vite, browser UI, Supabase, or AI/LLM libraries. These errors are the
 * domain's own vocabulary and are thrown by domain code only.
 */

export type RsmErrorCode =
  | "SERIALIZATION_ERROR"
  | "VALIDATION_ERROR"
  | "CRYPTO_UNAVAILABLE"
  | "INVALID_TRANSITION"
  | "INTEGRITY_MISMATCH"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "SOURCE_UNSUPPORTED"
  | "SOURCE_TOO_LARGE"
  | "PERSISTENCE_ERROR"
  | "INTERNAL_ERROR";

export class RsmError extends Error {
  readonly code: RsmErrorCode;

  constructor(code: RsmErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RsmError";
    this.code = code;
  }
}

export class RsmSerializationError extends RsmError {
  constructor(message: string, options?: ErrorOptions) {
    super("SERIALIZATION_ERROR", message, options);
    this.name = "RsmSerializationError";
  }
}

export class RsmValidationError extends RsmError {
  constructor(message: string, options?: ErrorOptions) {
    super("VALIDATION_ERROR", message, options);
    this.name = "RsmValidationError";
  }
}