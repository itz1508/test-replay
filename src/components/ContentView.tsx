/**
 * Content viewers — one renderer per FullContent kind.
 *
 * text → scrollable <pre> with show-more for long content.
 * conversation → role-chipped message list.
 * folder → expandable entry table.
 * opaque → metadata summary.
 */
import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, User, Bot, Cpu } from "lucide-react";
import { shortId, formatBytes } from "../lib/format";
import { btnGhost } from "./ui";
import type { Bucket, FullContent, FolderEntry } from "../rsm/bucket/types";

export function ContentView({ bucket }: { bucket: Bucket }) {
  switch (bucket.full_content.kind) {
    case "text":
      return <TextView text={bucket.full_content.text} />;
    case "conversation":
      return <ConversationView conversation={bucket.full_content.conversation} />;
    case "folder":
      return <FolderView entries={bucket.full_content.entries} />;
    case "opaque":
      return <OpaqueView content={bucket.full_content} />;
    default:
      return <p className="text-sm text-muted">Unknown content kind.</p>;
  }
}

/* ---------- Text (plain / markdown / pdf-extracted) ---------- */

const MAX_LINES = 200;

function TextView({ text }: { text: string }) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const [expanded, setExpanded] = useState(lines.length <= MAX_LINES);

  const visible = expanded ? text : lines.slice(0, MAX_LINES).join("\n");

  return (
    <div>
      <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-muted p-4 font-mono text-[13px] leading-relaxed text-foreground">
        {visible}
        {!expanded && lines.length > MAX_LINES && (
          <span className="text-faint">… ({lines.length - MAX_LINES} more lines)</span>
        )}
      </pre>
      {lines.length > MAX_LINES && (
        <button type="button" className={`${btnGhost} mt-1 text-xs`} onClick={() => setExpanded(!expanded)}>
          {expanded ? `Show less (first ${MAX_LINES} lines)` : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

/* ---------- Conversation (ChatGPT) ---------- */

function ConversationView({ conversation }: { conversation: import("../rsm/bucket/types").Conversation }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-faint mb-2">
        <span className="font-medium text-muted">{conversation.title || "Untitled conversation"}</span>
        <span aria-hidden="true">·</span>
        <span>{conversation.messages.length} messages</span>
        {conversation.created_at && (
          <>
            <span aria-hidden="true">·</span>
            <span>{new Date(conversation.created_at).toLocaleDateString()}</span>
          </>
        )}
      </div>
      <div className="max-h-[65vh] space-y-1.5 overflow-auto rounded-lg border border-border p-3">
        {conversation.messages.map((msg, i) => (
          <MessageBlock key={msg.message_id ?? i} message={msg} />
        ))}
      </div>
    </div>
  );
}

const ROLE_ICONS: Record<string, typeof User> = {
  user: User,
  assistant: Bot,
  system: Cpu,
};

function MessageBlock({ message }: { message: import("../rsm/bucket/types").ConversationMessage }) {
  const RoleIcon = ROLE_ICONS[message.role] ?? User;
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] ${
          isUser ? "bg-primary-soft text-primary" : "bg-surface-muted text-muted"
        }`}
      >
        <RoleIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <div className={`max-w-[85%] ${isUser ? "text-right" : ""}`}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <span className="capitalize">{message.role}</span>
          {message.timestamp && <span className="text-faint">{new Date(message.timestamp).toLocaleTimeString()}</span>}
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-[13px] leading-relaxed text-foreground">
          {message.content}
        </pre>
      </div>
    </div>
  );
}

/* ---------- Folder ---------- */

function FolderView({ entries }: { entries: FolderEntry[] }) {
  return (
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface-muted text-[11px] font-semibold uppercase tracking-wider text-faint">
          <tr>
            <th className="px-3 py-2">Path</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="px-3 py-2 font-mono">Hash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <FolderEntryRow key={entry.relative_path} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FolderEntryRow({ entry }: { entry: FolderEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isText = entry.content.kind === "text";

  return (
    <>
      <tr
        className={`cursor-pointer text-[13px] transition-colors hover:bg-surface-muted ${isText ? "cursor-pointer" : ""}`}
        onClick={() => isText && setExpanded(!expanded)}
      >
        <td className="flex items-center gap-1.5 px-3 py-2">
          {isText &&
            (expanded ? <ChevronDown className="h-3 w-3 text-faint" /> : <ChevronRight className="h-3 w-3 text-faint" />)}
          <span className="truncate font-medium text-foreground">{entry.relative_path}</span>
        </td>
        <td className="px-3 py-2 text-faint">{entry.source_type}</td>
        <td className="px-3 py-2 text-right font-mono text-faint">{formatBytes(entry.size_bytes)}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-faint">{entry.hash ? shortId(entry.hash) : "—"}</td>
      </tr>
      {expanded && isText && (
        <tr>
          <td colSpan={4} className="px-4 pb-3">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted/70 p-3 text-[13px] font-mono leading-relaxed text-foreground">
              {entry.content.kind === "text" ? entry.content.text : ""}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------- Opaque (binary) ---------- */

function OpaqueView({ content }: { content: Extract<FullContent, { kind: "opaque" }> }) {
  const bytes = content.bytes.length * 0.75; // base64 → byte estimate
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-4 text-sm">
      <p className="font-medium text-foreground">Binary content</p>
      <div className="flex flex-wrap gap-4 text-faint">
        <span>Size: {formatBytes(Math.round(bytes))}</span>
        {content.mime_type && <span>MIME: {content.mime_type}</span>}
        <span>Encoding: {content.encoding}</span>
      </div>
      <p className="text-xs text-faint">
        RSM stores binary content as-is but never interprets or converts it. Use the JSON export to retrieve the raw payload.
      </p>
    </div>
  );
}