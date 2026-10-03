/**
 * PDF extractor — deterministic text extraction via pdfjs-dist (browser runtime).
 *
 * Source type: `pdf`. This is the ONLY external-package dependency of RSM v1
 * (PRD §Integrations). pdfjs-dist runs entirely client-side, needs no API key,
 * and never sends data across the network. If extraction fails or produces no
 * text, RSM reports `SOURCE_UNSUPPORTED` — it never fabricates content.
 *
 * The module uses dynamic `import("pdfjs-dist")` so the bundler only resolves
 * it when this function is called (not on initial module import), keeping the
 * rest of the RSM tree pure-TypeScript.
 *
 * A worker source URL is required for pdfjs in modern bundlers. By default it
 * uses the Vite-managed `new URL("pdfjs-dist/build/pdf.worker.min.mjs",
 * import.meta.url)` pattern — the caller may override with `workerSrc`.
 *
 * Pure TypeScript — no AI, no Vite-specific static imports, no Supabase.
 */

import { RsmError } from "../errors";
import { DEFAULT_EXTRACTION_LIMITS, type ExtractedSource, type ExtractionLimits } from "./types";

export interface PdfExtractionInput {
  /** Source label (file name). */
  source: string;
  /** Raw PDF bytes. */
  data: Uint8Array;
  /** Original source path when known. */
  sourcePath?: string | null;
  /** Override pdfjs worker src URL. Default: Vite-compatible URL. */
  workerSrc?: string | null;
  /** Optional limits override. */
  limits?: ExtractionLimits;
}

function defaultWorkerSrc(): string | undefined {
  try {
    return new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  } catch {
    return undefined;
  }
}

/**
 * Extract text from a PDF using pdfjs-dist (browser runtime).
 *
 * - Pages are processed sequentially; page boundaries are preserved with "\n\n".
 * - Each page's text items are assembled with item-level line breaks preserved
 *   via the `hasEOL` flag (deterministic mapping).
 * - If no extractable text is found, `SOURCE_UNSUPPORTED` is thrown (RSM never
 *   fabricates text).
 */
export async function extractPdf(input: PdfExtractionInput): Promise<ExtractedSource> {
  const limits: Required<ExtractionLimits> = { ...DEFAULT_EXTRACTION_LIMITS, ...(input.limits ?? {}) };
  const rawBytes = input.data.byteLength;

  // pdfjs-dist is the single external dependency allowed by the PRD.
  const pdfjs = await import("pdfjs-dist");
  const worker = input.workerSrc ?? defaultWorkerSrc();
  if (worker) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
  }

  const doc = await pdfjs.getDocument({ data: input.data }).promise;
  try {
    const numPages = doc.numPages;
    const pageTexts: string[] = [];

    for (let p = 1; p <= numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const textContent = await page.getTextContent();
        const lines: string[] = [];
        let currentLine = "";
        for (const rawItem of textContent.items) {
          const item = rawItem as { str?: string; hasEOL?: boolean };
          const str = typeof item.str === "string" ? item.str : "";
          currentLine += str;
          if (item.hasEOL) {
            lines.push(currentLine);
            currentLine = "";
          }
        }
        if (currentLine.length > 0) lines.push(currentLine);
        pageTexts.push(lines.join("\n"));
      } finally {
        await page.cleanup();
      }
    }

    const fullText = pageTexts.join("\n\n").replace(/\r\n?/g, "\n");

    if (fullText.trim().length === 0) {
      throw new RsmError(
        "SOURCE_UNSUPPORTED",
        `No extractable text found in PDF "${input.source}". RSM reports extraction failure rather than fabricating content.`,
      );
    }

    if (utf8ByteLength(fullText) > limits.maxSourceBytes) {
      throw new RsmError(
        "SOURCE_TOO_LARGE",
        `Extracted text from PDF "${input.source}" exceeds the ${limits.maxSourceBytes}-byte source limit.`,
      );
    }

    return {
      source: input.source,
      source_type: "pdf",
      source_origin: "file",
      sizeBytes: rawBytes,
      full_content: { kind: "text", text: fullText },
      mime_type: "application/pdf",
      source_path: input.sourcePath ?? null,
      capture_note: "PDF text extracted via pdfjs-dist (page structure preserved with double-newline separators).",
      metadata: {
        pdf_page_count: numPages,
        extracted_chars: fullText.length,
        extractor: "pdfjs-dist",
      },
    };
  } finally {
    await doc.destroy();
  }
}

// Re-use the existing helper rather than re-importing.
function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).length;
}