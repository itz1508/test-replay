/**
 * SCAN — fast, shallow source discovery.
 *
 * `scanBucket` derives the file boundaries of a bucket WITHOUT loading or
 * interpreting its deep content. Folder buckets enumerate their entries;
 * whole-source buckets are exposed as a single File ("1 File"), which keeps
 * simple text simple (Source → File 1). Nothing is summarized, chunked for an
 * Agent, or loaded into memory here — sizes come from stored metadata, not
 * from content reads.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { Bucket } from "../bucket/types";
import type { ScanFile, ScanResult } from "./types";

/** Whole-bucket sources (non-folder) are exposed as File 1. */
export function scanBucket(bucket: Bucket): ScanResult {
  if (bucket.full_content.kind === "folder") {
    const files: ScanFile[] = bucket.full_content.entries.map((entry, i) => ({
      file_id: entry.relative_path || `${bucket.bucket_id}::f${i + 1}`,
      name: entry.source_name || entry.relative_path,
      relative_path: entry.relative_path,
      source_type: entry.source_type,
      size_bytes: entry.size_bytes,
      page_count: null, // not determinable cheaply at scan time
      kind: entry.content.kind === "text" ? "text" : "opaque",
      readable: entry.content.kind === "text",
    }));

    return {
      source: bucket.source,
      total_files: files.length,
      total_bytes: files.reduce((sum, f) => sum + f.size_bytes, 0),
      files,
    };
  }

  // Whole-source bucket: one bounded File (Source File 1).
  const size =
    bucket.full_content.kind === "text"
      ? new TextEncoder().encode(bucket.full_content.text).length
      : bucket.full_content.kind === "conversation"
        ? new TextEncoder().encode(JSON.stringify(bucket.full_content.conversation)).length
        : bucket.full_content.bytes ? new TextEncoder().encode(bucket.full_content.bytes).length : 0;
  const file: ScanFile = {
    file_id: `${bucket.bucket_id}::root`,
    name: bucket.source,
    relative_path: null,
    source_type: bucket.source_type,
    size_bytes: size,
    page_count: null,
    kind: bucket.full_content.kind === "text" ? ("text" as const) : bucket.full_content.kind === "conversation" ? ("document" as const) : ("opaque" as const),
    readable: bucket.full_content.kind !== "opaque",
  };
  return { source: bucket.source, total_files: 1, total_bytes: file.size_bytes, files: [file] };
}