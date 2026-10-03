/**
 * Folder extractor — deterministic folder ingestion via file enumeration.
 *
 * Source type: `folder`. A folder produces **one bucket** whose `full_content`
 * is a deterministic ordered list of per-file entries (sorted by relative_path,
 * codepoint order). Each entry carries its own identity, SHA-256 hash (computed
 * at extraction time from raw bytes), size, and either extracted text (for
 * text-like files) or an opaque base64 reference (for binaries).
 *
 * RSM does NOT collapse a folder into an anonymous blob — per-source identity,
 * provenance, and integrity are preserved (AC-14, AC-15).
 *
 * Pure TypeScript — no AI, no Vite, no Supabase.
 */

import { RsmError } from "../errors";
import type { Hasher } from "../crypto/hash";
import { getDefaultHasher } from "../crypto/hash";
import { canonicalJson } from "../bucket/serialization";
import type { FolderEntry, FullContent } from "../bucket/types";
import { DEFAULT_EXTRACTION_LIMITS, type ExtractedSource, type ExtractionLimits } from "./types";
import { bytesToBase64, decodeUtf8Strict } from "./utils";

/* ---------- Public types ---------- */

export interface FolderFileSource {
  /** File basename (for FolderEntry.source_name). */
  name: string;
  /** Relative path within the folder (unique, sortable). */
  relative_path: string;
  size_bytes: number;
  mime_type: string | null;
  /** Read the full file contents as raw bytes. */
  readBytes(): Promise<Uint8Array>;
}

export interface FolderExtractionInput {
  /** Folder name/label (bucket.source). */
  source: string;
  /** All files discovered in the folder (flattened). */
  files: FolderFileSource[];
  /** Original source path when known. */
  sourcePath?: string | null;
  /** Optional limits override. */
  limits?: ExtractionLimits;
  hasher?: Hasher;
  /**
   * Recognised text extensions (case-insensitive comparison).
   * Files whose extension appears in this list (or whose MIME starts with
   * `text/`) are decoded as UTF-8 text; otherwise they are stored as opaque.
   */
  textExtensions?: string[];
}

/** Default set of recognised textual extensions (deterministic). */
export const TEXT_EXTENSIONS = [
  ".md", ".markdown", ".txt", ".text",
  ".json", ".csv", ".tsv", ".yaml", ".yml", ".xml", ".toml",
  ".html", ".htm", ".xhtml", ".css", ".js", ".ts", ".jsx", ".tsx",
  ".py", ".rb", ".sh", ".bash", ".zsh", ".sql", ".ini", ".conf",
  ".log", ".env", ".cfg", ".gradle", ".properties",
];

/** MIME type prefixes considered textual (deterministic). */
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
];

/* ---------- Helpers ---------- */

function codepointCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isTextByExtension(relativePath: string, extensions: string[]): boolean {
  const lower = relativePath.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function isTextByMime(mime: string | null, prefixes: string[]): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return prefixes.some((p) => lower.startsWith(p));
}

/** Detect source_type for a textual entry (extension-based heuristic). */
function sourceTypeForEntry(relativePath: string): "markdown" | "txt" | "pdf" | "binary" {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  return "txt";
}

/** Detect source_type for a binary/opaque entry. */
function opaqueSourceType(relativePath: string, mime: string | null): "pdf" | "binary" {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  return "binary";
}

/* ---------- Main extractor ---------- */

/**
 * Deterministic folder ingestion.
 *
 * - Files are sorted by `relative_path` (codepoint order) — stable across
 *   all environments.
 * - Each known-textual file is decoded as UTF-8 (fatal on invalid bytes);
 *   otherwise → opaque base64.
 * - Per-file SHA-256 fingerprints are computed and stored in each entry.
 * - The folder bucket's content hash will be computed at VERIFY time over the
 *   canonical JSON of the entire entry list.
 * - Throws `SOURCE_TOO_LARGE` / `VALIDATION_ERROR` on constraint violations.
 */
export async function extractFolder(input: FolderExtractionInput): Promise<ExtractedSource> {
  const limits: Required<ExtractionLimits> = { ...DEFAULT_EXTRACTION_LIMITS, ...(input.limits ?? {}) };
  const hasher = input.hasher ?? getDefaultHasher();
  const textExtensions = input.textExtensions ?? TEXT_EXTENSIONS;

  const files = [...input.files];
  if (files.length === 0) {
    throw new RsmError("VALIDATION_ERROR", `Folder "${input.source}" contains no files; nothing to capture.`);
  }
  if (files.length > limits.maxFolderEntries) {
    throw new RsmError(
      "SOURCE_TOO_LARGE",
      `Folder "${input.source}" has ${files.length} files, exceeding the ${limits.maxFolderEntries}-entry limit.`,
    );
  }

  // Sort deterministically by relative_path.
  files.sort((a, b) => codepointCompare(a.relative_path, b.relative_path));

  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size_bytes;
  }
  if (totalBytes > limits.maxFolderBytes) {
    throw new RsmError(
      "SOURCE_TOO_LARGE",
      `Folder "${input.source}" totals ${totalBytes} bytes, exceeding the ${limits.maxFolderBytes}-byte limit.`,
    );
  }

  const entries: FolderEntry[] = [];
  const entryHashes: string[] = [];

  for (const file of files) {
    if (file.size_bytes > limits.maxFileBytes) {
      throw new RsmError(
        "SOURCE_TOO_LARGE",
        `File "${file.relative_path}" (${file.size_bytes} bytes) exceeds the ${limits.maxFileBytes}-byte per-file limit in a folder.`,
      );
    }

    const bytes = await file.readBytes();
    const entryHash = await hasher.sha256Hex(bytes);
    entryHashes.push(entryHash);

    // Decide text vs opaque.
    const isTextual =
      isTextByMime(file.mime_type, TEXT_MIME_PREFIXES) ||
      isTextByExtension(file.relative_path, textExtensions);

    let entry: FolderEntry;
    if (isTextual) {
      try {
        const text = decodeUtf8Strict(bytes);
        entry = {
          relative_path: file.relative_path,
          source_name: file.name,
          source_type: sourceTypeForEntry(file.relative_path),
          size_bytes: file.size_bytes,
          hash: entryHash,
          content: { kind: "text", text },
        };
      } catch {
        // Invalid UTF-8 (or undecodable) — never misrepresent binary as text.
        entry = {
          relative_path: file.relative_path,
          source_name: file.name,
          source_type: opaqueSourceType(file.relative_path, file.mime_type),
          size_bytes: file.size_bytes,
          hash: entryHash,
          content: {
            kind: "opaque",
            encoding: "base64",
            mime_type: file.mime_type,
            bytes: bytesToBase64(bytes),
          },
        };
      }
    } else {
      entry = {
        relative_path: file.relative_path,
        source_name: file.name,
        source_type: opaqueSourceType(file.relative_path, file.mime_type),
        size_bytes: file.size_bytes,
        hash: entryHash,
        content: {
          kind: "opaque",
          encoding: "base64",
          mime_type: file.mime_type,
          bytes: bytesToBase64(bytes),
        },
      };
    }
    entries.push(entry);
  }

  const fullContent: FullContent = { kind: "folder", entries };

  // Deterministic entry digest: canonical JSON of a sorted summary.
  const entryDigestData = entries.map((e) => ({
    relative_path: e.relative_path,
    source_type: e.source_type,
    size_bytes: e.size_bytes,
    hash: e.hash,
  }));
  const sortedDigest = await hasher.sha256Hex(canonicalJson(entryDigestData));

  return {
    source: input.source,
    source_type: "folder",
    source_origin: "folder",
    sizeBytes: totalBytes,
    full_content: fullContent,
    mime_type: null,
    source_path: input.sourcePath ?? null,
    capture_note:
      "Folder ingested deterministically; each file extracted/preserved as a named entry in sorted order. Opaque binaries carry reference identity (never misrepresented as extracted text).",
    metadata: {
      folder_entry_count: entries.length,
      folder_total_bytes: totalBytes,
      folder_sorted_digest: sortedDigest,
      folder_extensions: TEXT_EXTENSIONS.slice(), // which set was used
    },
  };
}