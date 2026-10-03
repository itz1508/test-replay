/**
 * Plain-text extractor — deterministic normalization of raw text.
 *
 * Source types: `txt` (file) and `pasted_text` (paste). Normalization is
 * byte-stable: BOM stripped, CRLF/CR line endings normalized to LF. Content is
 * never trimmed, summarized, or reinterpreted — normalization preserves the
 * source verbatim apart from the documented byte transforms.
 *
 * Pure TypeScript — no AI, no Vite, no Supabase.
 */

import { RsmError } from "../errors";
import { DEFAULT_EXTRACTION_LIMITS, type ExtractedSource, type ExtractionLimits } from "./types";
import { utf8ByteLength } from "./utils";

export interface TextExtractionInput {
  /** Source label (file name or paste label). */
  source: string;
  /** Raw input text (pre-normalization). */
  text: string;
  /** Canonical source type; defaults to "txt". */
  sourceType?: "txt" | "pasted_text";
  /** Original source path when known. */
  sourcePath?: string | null;
  /** Original MIME type when known. */
  mimeType?: string | null;
  /** Optional size/entry limits override. */
  limits?: ExtractionLimits;
}

/**
 * Canonical text normalization:
 * 1. strip a leading UTF-8 BOM (U+FEFF),
 * 2. normalize CRLF ("\r\n") and CR ("\r") line endings to LF ("\n").
 * Deterministic and environment-agnostic.
 */
export function normalizeText(input: string): string {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Normalize plain text into an `ExtractedSource` (txt | pasted_text).
 * Throws `SOURCE_TOO_LARGE` over the configured single-source byte limit.
 */
export function extractText(input: TextExtractionInput): ExtractedSource {
  const limits: Required<ExtractionLimits> = { ...DEFAULT_EXTRACTION_LIMITS, ...(input.limits ?? {}) };
  const rawBytes = utf8ByteLength(input.text);
  if (rawBytes > limits.maxSourceBytes) {
    throw new RsmError(
      "SOURCE_TOO_LARGE",
      `Text source "${input.source}" is ${rawBytes} bytes, exceeding the ${limits.maxSourceBytes}-byte limit for a single source.`,
    );
  }

  const sourceType = input.sourceType ?? "txt";
  const normalized = normalizeText(input.text);
  const isPasted = sourceType === "pasted_text";

  return {
    source: input.source,
    source_type: sourceType,
    source_origin: isPasted ? "paste" : "file",
    sizeBytes: rawBytes,
    full_content: { kind: "text", text: normalized },
    mime_type: input.mimeType ?? (isPasted ? "text/plain" : null),
    source_path: input.sourcePath ?? null,
    capture_note: isPasted
      ? "Pasted text normalized (BOM stripped, line endings → LF); stored verbatim."
      : "Plain text file normalized (BOM stripped, line endings → LF); stored verbatim.",
    metadata: {
      normalization: "utf8_lf",
      char_count: normalized.length,
    },
  };
}