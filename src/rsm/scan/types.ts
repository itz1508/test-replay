/**
 * SCAN — canonical scan/types contract.
 *
 * SCAN is fast, shallow discovery: "What exists and how can it be accessed?"
 * It surfaces files, types, sizes, boundaries, page counts (when known cheaply),
 * metadata and basic structure. It NEVER deeply interprets all content, never
 * summarizes, never reasons about importance, never composes Agent context,
 * and never silently replaces Reader.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { SourceType } from "../bucket/types";

/**
 * One bounded, addressable piece of source material a Reader may observe.
 * This is the `File` concept: a File is NOT a new authoritative Source.
 */
export interface ScanFile {
  /** Stable identity of this file within its source (addressable, bounded). */
  file_id: string;
  /** Human label (filename or "document" for whole-source text). */
  name: string;
  /** Relative path within the source tree when applicable. */
  relative_path: string | null;
  source_type: SourceType;
  /** Byte size of this file's content. */
  size_bytes: number;
  /** Page count when cheaply determinable from metadata, else null. */
  page_count: number | null;
  /** Basic structure hint (e.g. "text", "table", "image") when known cheaply. */
  kind: "text" | "document" | "image" | "opaque";
  /** Whether a Reader can attempt observation at this boundary. */
  readable: boolean;
}

/** Result of one shallow SCAN — file boundaries only, never loaded content. */
export interface ScanResult {
  /** Source identity the scan was run against. */
  source: string;
  /** Total files discovered. */
  total_files: number;
  /** Sum of discovered file sizes. */
  total_bytes: number;
  /** Bounded, addressable files in deterministic order. */
  files: ScanFile[];
}