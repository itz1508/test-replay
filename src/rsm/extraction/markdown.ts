/**
 * Markdown extractor — canonical capture of Markdown content.
 *
 * Source type: `markdown`. RSM captures raw Markdown VERBATIM (the source text
 * is the authoritative content — RSM does not render, strip, or summarise).
 * Normalization is byte-deterministic: BOM stripped, CRLF/CR → LF. A
 * deterministic heading outline is captured in `metadata` for inspection only;
 * it is non-authoritative and never replaces the source text.
 *
 * Pure TypeScript — no AI, no Vite, no Supabase.
 */

import { RsmError } from "../errors";
import { DEFAULT_EXTRACTION_LIMITS, type ExtractedSource, type ExtractionLimits } from "./types";
import { utf8ByteLength } from "./utils";
import { normalizeText } from "./text";

export interface MarkdownExtractionInput {
  /** Source label (file name). */
  source: string;
  /** Raw Markdown source (pre-normalization). */
  text: string;
  /** Original source path when known. */
  sourcePath?: string | null;
  /** Original MIME type when known; defaults to text/markdown. */
  mimeType?: string | null;
  /** Optional limits override. */
  limits?: ExtractionLimits;
}

/** Deterministic heading outline: ATX headings (`#`..`######`) in source order. */
export function headingOutline(markdown: string): { level: number; heading: string }[] {
  const outline: { level: number; heading: string }[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      outline.push({ level: match[1].length, heading: match[2].trim() });
    }
  }
  return outline;
}

/**
 * Normalize a Markdown source into an `ExtractedSource` (kind `text`).
 * Throws `SOURCE_TOO_LARGE` over the configured byte limit.
 */
export function extractMarkdown(input: MarkdownExtractionInput): ExtractedSource {
  const limits: Required<ExtractionLimits> = { ...DEFAULT_EXTRACTION_LIMITS, ...(input.limits ?? {}) };
  const rawBytes = utf8ByteLength(input.text);
  if (rawBytes > limits.maxSourceBytes) {
    throw new RsmError(
      "SOURCE_TOO_LARGE",
      `Markdown source "${input.source}" is ${rawBytes} bytes, exceeding the ${limits.maxSourceBytes}-byte limit.`,
    );
  }

  const normalized = normalizeText(input.text);
  const headingNumbers = normalized.split("\n").reduce(
    (acc, line) => (/^(#{1,6})\s/.test(line) ? acc + 1 : acc),
    0,
  );

  return {
    source: input.source,
    source_type: "markdown",
    source_origin: "file",
    sizeBytes: rawBytes,
    full_content: { kind: "text", text: normalized },
    mime_type: input.mimeType ?? "text/markdown",
    source_path: input.sourcePath ?? null,
    capture_note: "Markdown captured verbatim (BOM stripped, line endings → LF); heading outline recorded as non-authoritative metadata.",
    metadata: {
      format: "markdown",
      normalization: "utf8_lf",
      char_length: normalized.length,
      heading_count: headingNumbers,
    },
  };
}

export { normalizeText };