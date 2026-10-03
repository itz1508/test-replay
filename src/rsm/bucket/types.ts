/**
 * Canonical bucket model — RSM's authoritative schema.
 *
 * A Bucket is the single unit of external context in RSM. It carries source
 * identity, provenance, integrity state, lifecycle state, and full content.
 *
 * This module is pure TypeScript. Zero imports from React, Vite, browser UI,
 * Supabase, or AI libraries. It is safe to run in Node.js, browsers, or any
 * future daemon runtime.
 */

import type { Provenance } from "../provenance/types";

/** Canonical schema version for buckets and replay payloads. */
export const SCHEMA_VERSION = "1";

/** Canonical source types (bucket `source_type`). */
export const SOURCE_TYPES = {
  Markdown: "markdown",
  Txt: "txt",
  PastedText: "pasted_text",
  ChatGptExport: "chatgpt_export",
  Pdf: "pdf",
  Folder: "folder",
  Binary: "binary",
} as const;
export type SourceType = (typeof SOURCE_TYPES)[keyof typeof SOURCE_TYPES];

/** Canonical source origins (bucket `source_origin`). */
export const SOURCE_ORIGINS = {
  Paste: "paste",
  File: "file",
  Folder: "folder",
  ChatGptExport: "chatgpt_export",
} as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[keyof typeof SOURCE_ORIGINS];

/**
 * Canonical lifecycle states (bucket `lifecycle_state`).
 *
 * Full chain: CAPTURED -> VERIFIED -> STORED -> READY -> ACTIVE -> RELEASED -> CLOSED.
 * (Task descriptions may summarize the core path; the PRD state machine is the
 * authoritative contract and includes ACTIVE and CLOSED.)
 */
export const LIFECYCLE_STATES = {
  Captured: "CAPTURED",
  Verified: "VERIFIED",
  Stored: "STORED",
  Ready: "READY",
  Active: "ACTIVE",
  Released: "RELEASED",
  Closed: "CLOSED",
} as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[keyof typeof LIFECYCLE_STATES];

/** Canonical integrity status (bucket `integrity_status`). */
export const INTEGRITY_STATUSES = {
  Valid: "VALID",
  Invalid: "INVALID",
  Unverified: "UNVERIFIED",
} as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[keyof typeof INTEGRITY_STATUSES];

/**
 * full_content union — the authoritative payload of a bucket.
 *
 * - `text`: plain / normalized text content (markdown, txt, pasted text, pdf-extracted).
 * - `conversation`: structured conversation (ChatGPT export) — preserves roles,
 *   message identity, timestamps, and thread identity. NEVER flattened to
 *   arbitrary user:/assistant: text.
 * - `folder`: deterministic ordered list of per-source entries (not a blob).
 * - `opaque`: binary content stored as an opaque reference (base64) with
 *   identity/provenance/integrity preserved but never misrepresented as text.
 */
export interface ConversationMessage {
  /** Original role marker, e.g. "user" | "assistant" | "system". */
  role: string;
  /** Original message content, verbatim. */
  content: string;
  /** Original timestamp when available (ISO-8601, possibly with offsets). */
  timestamp: string | null;
  /** Original message id when available (preserved verbatim). */
  message_id: string | null;
}

export interface Conversation {
  /** Conversation/thread id as present in the source export. */
  id: string;
  /** Title as present in the source export, or null. */
  title: string | null;
  /** Original creation timestamp of the conversation, or null. */
  created_at: string | null;
  /** Original update timestamp of the conversation, or null. */
  updated_at: string | null;
  /** Messages in original sequence order. */
  messages: ConversationMessage[];
}

export interface FolderEntryContent {
  kind: "text" | "opaque";
}

/** One entry inside a folder bucket — per-file identity/provenance is preserved. */
export interface FolderEntry {
  relative_path: string;
  source_name: string;
  source_type: SourceType;
  size_bytes: number;
  /** Per-entry SHA-256 (hex) over the entry's own canonical bytes; null until verified. */
  hash: string | null;
  content:
    | { kind: "text"; text: string }
    | { kind: "opaque"; encoding: "base64"; mime_type: string | null; bytes: string };
}

export type FullContent =
  | { kind: "text"; text: string }
  | { kind: "conversation"; conversation: Conversation }
  | { kind: "folder"; entries: FolderEntry[] }
  | { kind: "opaque"; encoding: "base64"; mime_type: string | null; bytes: string };

/**
 * The canonical RSM bucket.
 *
 * Canonical serialization (serialization.ts) outputs deterministic sorted keys
 * with no whitespace, so both `hash` and JSON export are stable across
 * environments.
 */
export interface Bucket {
  schema_version: string;
  bucket_id: string;
  /** Source name/label (e.g. filename or paste label). */
  source: string;
  source_type: SourceType;
  source_origin: SourceOrigin;
  /** User-supplied intent only; never inferred. */
  intent: string | null;
  lifecycle_state: LifecycleState;
  /** ISO-8601 UTC. */
  created_timestamp: string;
  /** SHA-256 hex fingerprint; null until VERIFIED. */
  hash: string | null;
  integrity_status: IntegrityStatus;
  provenance: Provenance;
  full_content: FullContent;
  /** Non-authoritative; null unless explicitly provided. */
  optional_summary: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
}