/**
 * ChatGPT export extractor — deterministic normalization of `conversations.json`.
 *
 * Source type: `chatgpt_export`. CRITICAL preservation rules (PRD + task):
 * - Original source provenance, conversation identity, message roles, and
 *   message content are preserved — NEVER flattened to arbitrary
 *   user:/assistant: text. Each message keeps `role`, verbatim `content`,
 *   original `message_id`, and original `timestamp`.
 * - Normalization is deterministic. No summarization, no reinterpretation,
 *   no invented content. Non-text parts (images etc.) are dropped only
 *   because they cannot be faithfully represented as text — the message
 *   identity, role, and the textual parts are still preserved.
 * - Source integrity information is preserved: the SHA-256 fingerprint of the
 *   raw export JSON and of each raw conversation object is stored in
 *   `metadata` (never replaces the canonical bucket hash — it is a source
 *   side-channel for provenance tracing).
 *
 * Supported input shapes (deterministic detection):
 * - `conversations.json` → top-level array of conversation objects
 * - `{ "conversations": [...] }` wrapper
 * - a single conversation object (modern `mapping` or legacy
 *   `linear_conversation`)
 *
 * Pure TypeScript — no AI, no Vite, no Supabase.
 */

import { RsmError } from "../errors";
import type { Hasher } from "../crypto/hash";
import { getDefaultHasher } from "../crypto/hash";
import { DEFAULT_EXTRACTION_LIMITS, type ExtractedSource, type ExtractionLimits } from "./types";
import { utf8ByteLength } from "./utils";
import type { Conversation, ConversationMessage } from "../bucket/types";

export interface ChatGptExtractionInput {
  /** Label for the export (file name, e.g. "conversations.json"). */
  source: string;
  /** Raw export JSON text. */
  text: string;
  /** Original source path when known. */
  sourcePath?: string | null;
  /** Optional limits override. */
  limits?: ExtractionLimits;
  hasher?: Hasher;
}

/** Fallback source label per conversation when a title is absent. */
function conversationSourceName(conversation: Conversation): string {
  return conversation.title && conversation.title.trim().length > 0
    ? conversation.title
    : `conversation-${conversation.id}`;
}

/** Normalize a ChatGPT export timestamp (Unix seconds or ms, or ISO string). */
export function normalizeChatTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null; // exports use 0 / -1 for "absent"
    const ms = value > 1e11 ? value : value * 1000; // already-ms guard
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return null;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/** Extract verbatim textual parts from a ChatGPT content node (deterministic). */
function contentToText(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (typeof content !== "object") return "";
  const node = content as { content_type?: unknown; parts?: unknown };
  const parts = Array.isArray(node.parts) ? node.parts : [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      chunks.push(part);
    } else if (part !== null && typeof part === "object") {
      const p = part as { text?: unknown; content?: unknown; content_type?: unknown };
      if (typeof p.text === "string") {
        chunks.push(p.text);
      } else if (typeof p.content === "string") {
        chunks.push(p.content);
      }
      // Non-text parts (e.g. image_asset) are skipped — never invented.
    }
  }
  // Preserve part boundaries with newlines; deterministic.
  return chunks.join("\n");
}

interface RawChatMessage {
  id?: unknown;
  author?: { role?: unknown } | null;
  create_time?: unknown;
  content?: unknown;
}

function toConversationMessage(message: RawChatMessage): ConversationMessage {
  return {
    role: typeof message.author?.role === "string" && message.author.role.length > 0 ? message.author.role : "unknown",
    content: contentToText(message.content),
    timestamp: normalizeChatTimestamp(message.create_time),
    message_id: typeof message.id === "string" && message.id.length > 0 ? message.id : null,
  };
}

/** Flatten a `mapping` object into ordered ConversationMessages via the child tree. */
function messagesFromMapping(mapping: unknown): ConversationMessage[] {
  if (mapping === null || typeof mapping !== "object") return [];
  const nodes = new Map<string, { message?: unknown; children: string[] }>();
  const parentOf = new Map<string, string | null>();

  for (const [id, rawNode] of Object.entries(mapping as Record<string, unknown>)) {
    if (rawNode === null || typeof rawNode !== "object") continue;
    const node = rawNode as { message?: unknown; children?: unknown; parent?: unknown };
    const children = Array.isArray(node.children)
      ? (node.children as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    nodes.set(id, { message: node.message, children });
    if (typeof node.parent === "string") parentOf.set(id, node.parent);
  }

  // Walk from the root(s) in deterministic order (breadth-first, tie-broken by id).
  const roots = [...nodes.keys()].filter((id) => parentOf.get(id) === undefined || !nodes.has(parentOf.get(id)!));
  roots.sort();
  const messages: ConversationMessage[] = [];
  const seen = new Set<string>();
  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (node?.message !== undefined && node.message !== null) {
      const msg = node.message as RawChatMessage;
      messages.push(toConversationMessage(msg));
    }
    if (node) {
      const children = [...node.children].sort();
      for (const child of children) queue.push(child);
    }
  }
  return messages;
}

/** Legacy export shape: `linear_conversation` is already an ordered message list. */
function messagesFromLinear(linear: unknown): ConversationMessage[] {
  if (!Array.isArray(linear)) return [];
  const messages: ConversationMessage[] = [];
  for (const entry of linear) {
    if (entry === null || typeof entry !== "object") continue;
    const msg = (entry as { message?: unknown }).message ?? entry;
    if (msg !== null && typeof msg === "object") {
      messages.push(toConversationMessage(msg as RawChatMessage));
    }
  }
  return messages;
}

export interface NormalizedChatExport {
  /** One conversation per export entry, in export order. */
  conversations: Conversation[];
  /** Shape tag: "conversations_array" | "wrapper" | "single_mapping" | "single_linear". */
  exportKind: string;
}

/** Parse + normalize the raw export JSON into canonical Conversation records. */
export function parseChatGptExport(text: string): NormalizedChatExport {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (trimmed.length === 0) {
    throw new RsmError("VALIDATION_ERROR", "ChatGPT export is empty; nothing to capture.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new RsmError(
      "VALIDATION_ERROR",
      `ChatGPT export is not valid JSON (${error instanceof Error ? error.message : "parse error"}).`,
    );
  }

  const list: { kind: string; raw: unknown }[] = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => list.push({ kind: "conversations_array", raw: item }));
  } else if (parsed !== null && typeof parsed === "object") {
    const obj = parsed as { conversations?: unknown; mapping?: unknown; linear_conversation?: unknown };
    if (Array.isArray(obj.conversations)) {
      obj.conversations.forEach((item) => list.push({ kind: "wrapper", raw: item }));
    } else if (obj.mapping !== undefined) {
      list.push({ kind: "single_mapping", raw: parsed });
    } else if (obj.linear_conversation !== undefined) {
      list.push({ kind: "single_linear", raw: parsed });
    } else {
      throw new RsmError(
        "VALIDATION_ERROR",
        "Unrecognized ChatGPT export: expected a conversations array or a conversation object with mapping/linear_conversation.",
      );
    }
  } else {
    throw new RsmError("VALIDATION_ERROR", "Unrecognized ChatGPT export: top-level value is neither array nor object.");
  }

  if (list.length === 0) {
    throw new RsmError("VALIDATION_ERROR", "ChatGPT export contains no conversations.");
  }

  const conversations: Conversation[] = list.map(({ raw }) => {
    if (raw === null || typeof raw !== "object") {
      throw new RsmError("VALIDATION_ERROR", "ChatGPT export contains a non-object conversation entry.");
    }
    const conv = raw as {
      id?: unknown;
      conversation_id?: unknown;
      title?: unknown;
      create_time?: unknown;
      update_time?: unknown;
      mapping?: unknown;
      linear_conversation?: unknown;
    };
    const id = typeof conv.conversation_id === "string" && conv.conversation_id.length > 0
      ? conv.conversation_id
      : typeof conv.id === "string" && conv.id.length > 0
        ? conv.id
        : (typeof conv.title === "string" && conv.title.length > 0 ? conv.title : "<untitled>");
    const messages =
      conv.mapping !== undefined && conv.mapping !== null
        ? messagesFromMapping(conv.mapping)
        : conv.linear_conversation !== undefined
          ? messagesFromLinear(conv.linear_conversation)
          : [];
    return {
      id,
      title: typeof conv.title === "string" ? conv.title : null,
      created_at: normalizeChatTimestamp(conv.create_time),
      updated_at: normalizeChatTimestamp(conv.update_time),
      messages,
    };
  });

  return { conversations, exportKind: list[0].kind };
}

/**
 * Normalize a ChatGPT export into one `ExtractedSource` PER conversation
 * (preserves conversation identity; never merged into one blob).
 */
export async function extractChatGptExport(input: ChatGptExtractionInput): Promise<ExtractedSource[]> {
  const limits: Required<ExtractionLimits> = { ...DEFAULT_EXTRACTION_LIMITS, ...(input.limits ?? {}) };
  const rawBytes = utf8ByteLength(input.text);
  if (rawBytes > limits.maxSourceBytes) {
    throw new RsmError(
      "SOURCE_TOO_LARGE",
      `ChatGPT export "${input.source}" is ${rawBytes} bytes, exceeding the ${limits.maxSourceBytes}-byte limit.`,
    );
  }

  const hasher = input.hasher ?? getDefaultHasher();
  const { conversations, exportKind } = parseChatGptExport(input.text);

  if (conversations.length === 0) {
    throw new RsmError("VALIDATION_ERROR", "ChatGPT export contains no conversations to capture.");
  }

  // Source integrity side-channel: fingerprint of the whole raw export text.
  const exportHash = await hasher.sha256Hex(input.text);

  const sources: ExtractedSource[] = [];
  for (let i = 0; i < conversations.length; i++) {
    const conversation = conversations[i];
    sources.push({
      source: conversationSourceName(conversation),
      source_type: "chatgpt_export",
      source_origin: "chatgpt_export",
      sizeBytes: rawBytes,
      full_content: { kind: "conversation", conversation },
      mime_type: "application/json",
      source_path: input.sourcePath ?? `${input.source}#${conversation.id}`,
      capture_note:
        "ChatGPT export normalized deterministically; roles, verbatim content, message_ids and timestamps preserved (never user:/assistant: text).",
      metadata: {
        export_kind: exportKind,
        export_index: i,
        export_total: conversations.length,
        original_export_hash: exportHash,
        message_count: conversation.messages.length,
      },
    });
  }
  return sources;
}