/**
 * Ingest view — capture external context into RSM buckets.
 *
 * One capture panel per source kind (paste, markdown, txt, pdf, folder,
 * ChatGPT export). Every path builds one or more `ExtractedSource` via the
 * domain extractors, then runs them through the ingestion pipeline
 * (CAPTURED → VERIFIED → STORED → READY) via the store hook.
 */
import { useCallback, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Clipboard, FileJson, FileText, FolderOpen, X, ArrowRight } from "lucide-react";
import * as rsm from "../rsm";
import type { ExtractedSource } from "../rsm/extraction/types";
import type { IngestOptions } from "../rsm/extraction";
import type { FolderFileSource } from "../rsm/extraction/folder";
import type { RsmStore } from "../hooks/useRsm";
import { humanErrorMessage } from "../hooks/useRsm";
import { formatBytes } from "../lib/format";
import { Badge, Panel, Spinner, StateBadge, btnGhost, btnPrimary, inputCls } from "./ui";

type KindId = "plain" | "markdown" | "txt" | "pdf" | "folder" | "chatgpt";

const KINDS: { id: KindId; title: string; blurb: string; icon: typeof FileText }[] = [
  { id: "plain", title: "Paste text", blurb: "Clipboard notes, snippets, URLs worth remembering.", icon: Clipboard },
  { id: "markdown", title: "Markdown file", blurb: ".md files, captured verbatim, never rendered or summarized.", icon: FileText },
  { id: "txt", title: "Text file", blurb: "Plain .txt files, BOM-stripped with LF line endings.", icon: FileText },
  { id: "pdf", title: "PDF", blurb: "Extract text from PDFs (page order preserved).", icon: FileText },
  { id: "folder", title: "Folder", blurb: "Multi-file capture with per-file identity and hashes.", icon: FolderOpen },
  { id: "chatgpt", title: "ChatGPT export", blurb: "conversations.json — roles, ids, timestamps preserved.", icon: FileJson },
];

const KIND_TITLES: Record<KindId, string> = {
  plain: "Paste text",
  markdown: "Markdown file",
  txt: "Text file",
  pdf: "PDF",
  folder: "Folder",
  chatgpt: "ChatGPT export",
};

interface IngestRun {
  successes: { bucketId: string; source: string }[];
  failures: { source: string; message: string }[];
  totalSources: number;
}

export function IngestView({ store }: { store: RsmStore }) {
  const [kind, setKind] = useState<KindId | null>(null);
  const [intent, setIntent] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<IngestRun | null>(null);

  const runIngest = useCallback(
    async (build: () => Promise<ExtractedSource[]>) => {
      setBusy(true);
      try {
        const sources = await build();
        if (sources.length === 0) {
          setRun({ successes: [], failures: [{ source: "upload", message: "No usable sources were produced from this input." }], totalSources: 0 });
          return;
        }
        const options: IngestOptions = {
          intent: intent.trim() || undefined,
          labels: labelsText.split(",").map((s) => s.trim()).filter(Boolean),
          tool: "rsm-ui",
        };
        const result = await store.ingestBatch(sources, options);
        setRun({
          successes: result.successes.map((s) => ({ bucketId: s.bucket.bucket_id, source: s.bucket.source })),
          failures: result.failures.map((f) => ({ source: f.source, message: humanErrorMessage(f.error) })),
          totalSources: sources.length,
        });
        await store.refresh();
      } catch (err) {
        setRun({ successes: [], failures: [{ source: "ingest", message: humanErrorMessage(err) }], totalSources: 1 });
      } finally {
        setBusy(false);
      }
    },
    [intent, labelsText, store],
  );

  const reset = useCallback(() => {
    setKind(null);
    setIntent("");
    setLabelsText("");
    setRun(null);
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-foreground">Ingest</h1>
        <p className="mt-1 text-sm text-muted">
          Capture external context into RSM buckets. Content is never modified, summarized, or
          reinterpreted — it is stored verbatim under a SHA-256 fingerprint.
        </p>
      </div>

      {!kind ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-all duration-150 ease-out hover:border-primary/40 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary transition-transform duration-150 group-hover:scale-110">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <span className="text-sm font-semibold text-foreground">{k.title}</span>
                <span className="text-xs leading-relaxed text-muted">{k.blurb}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <KindForm
          kind={kind}
          intent={intent}
          setIntent={setIntent}
          labelsText={labelsText}
          setLabelsText={setLabelsText}
          busy={busy}
          onCancel={reset}
          onSubmit={runIngest}
        />
      )}

      {run && <IngestResult run={run} onCaptureAnother={() => setKind(null)} onDone={reset} />}
    </div>
  );
}

/* ---------- Result panel ---------- */

function IngestResult({ run, onCaptureAnother, onDone }: { run: IngestRun; onCaptureAnother: () => void; onDone: () => void }) {
  return (
    <Panel
      title="Ingest result"
      actions={<Badge tone={run.failures.length ? "warning" : "success"}>{run.successes.length} / {run.totalSources} captured</Badge>}
    >
      {run.successes.length > 0 && (
        <div className="mb-3 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">Captured & ready</p>
          {run.successes.map((s) => (
            <div key={s.bucketId} className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm">
              <span className="flex-1 truncate font-medium text-foreground">{s.source}</span>
              <StateBadge state="READY" />
            </div>
          ))}
        </div>
      )}
      {run.failures.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">Couldn't capture</p>
          {run.failures.map((f, i) => (
            <div key={`${f.source}-${i}`} className="flex items-start gap-2 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive">
              <span className="font-medium">{f.source}:</span>
              <span className="flex-1">{f.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className={btnPrimary} onClick={onCaptureAnother}>
          Capture another
        </button>
        <button type="button" className={btnGhost} onClick={onDone}>
          Done
        </button>
      </div>
    </Panel>
  );
}

/* ---------- Capture form ---------- */

function KindForm({
  kind,
  intent,
  setIntent,
  labelsText,
  setLabelsText,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: KindId;
  intent: string;
  setIntent: (v: string) => void;
  labelsText: string;
  setLabelsText: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (build: () => Promise<ExtractedSource[]>) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState("");
  const [sourceName, setSourceName] = useState("");

  const build = async (): Promise<ExtractedSource[]> => {
    const label = sourceName.trim();
    switch (kind) {
      case "plain":
        return [rsm.extraction.extractText({ source: label || "pasted text", text: paste, sourceType: "pasted_text" })];
      case "markdown": {
        const out: ExtractedSource[] = [];
        for (const f of files) out.push(rsm.extraction.extractMarkdown({ source: f.name, text: await f.text(), sourcePath: f.name }));
        return out;
      }
      case "txt": {
        const out: ExtractedSource[] = [];
        for (const f of files) out.push(rsm.extraction.extractText({ source: f.name, text: await f.text(), sourcePath: f.name }));
        return out;
      }
      case "pdf": {
        const f = files[0];
        if (!f) throw new rsm.RsmError("VALIDATION_ERROR", "Choose a PDF file first.");
        const bytes = new Uint8Array(await f.arrayBuffer());
        return [await rsm.extraction.extractPdf({ source: f.name, data: bytes, sourcePath: f.name })];
      }
      case "folder": {
        const first = files[0];
        if (!first) throw new rsm.RsmError("VALIDATION_ERROR", "Choose a folder first.");
        const folderFiles: FolderFileSource[] = files.map((f) => ({
          name: f.name,
          relative_path: webkitPath(f),
          size_bytes: f.size,
          mime_type: f.type || null,
          readBytes: async () => new Uint8Array(await f.arrayBuffer()),
        }));
        return [await rsm.extraction.extractFolder({ source: label || folderRootName(first), files: folderFiles })];
      }
      case "chatgpt": {
        const f = files[0];
        if (!f) throw new rsm.RsmError("VALIDATION_ERROR", "Choose a ChatGPT export (.json) file first.");
        return rsm.extraction.extractChatGptExport({ source: f.name, text: await f.text(), sourcePath: f.name });
      }
      default:
        return [];
    }
  };

  const canSubmit = kind === "plain" ? paste.trim().length > 0 || files.length > 0 : files.length > 0;

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  return (
    <Panel
      title={
        <span>
          New <span className="text-primary">{KIND_TITLES[kind]}</span> ingest
        </span>
      }
      actions={
        <button type="button" className={btnGhost} onClick={onCancel} aria-label="Cancel capture">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      <div className="space-y-3">
        {kind === "plain" && (
          <div className="space-y-1">
            <label htmlFor="paste-input" className="text-xs font-semibold text-muted">Paste or type content</label>
            <textarea
              id="paste-input"
              rows={10}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste text here…"
              className={`${inputCls} font-mono text-[13px] leading-relaxed`}
              disabled={busy}
            />
          </div>
        )}

        {(kind === "markdown" || kind === "txt" || kind === "pdf" || kind === "chatgpt") && (
          <FilePicker
            label={
              kind === "markdown" ? "Markdown file(s)" :
              kind === "txt" ? "Text file(s)" :
              kind === "pdf" ? "PDF file" :
              "ChatGPT export (conversations.json)"
            }
            accept={kind === "markdown" ? ".md,.markdown" : kind === "txt" ? ".txt,.text" : kind === "pdf" ? ".pdf,.PDF" : ".json"}
            multiple={kind === "markdown" || kind === "txt"}
            files={files}
            onChange={onPickFiles}
            disabled={busy}
          />
        )}

        {kind === "folder" && (
          <FilePicker
            label="Folder contents"
            multiple
            directory
            files={files}
            onChange={onPickFiles}
            disabled={busy}
            hint={
              files.length > 0
                ? `${files.length} files · ${formatBytes(files.reduce((n, f) => n + f.size, 0))} total — every file is fingerprinted into one bucket`
                : "Pick any folder — text and binary files are fingerprinted with per-file SHA-256."
            }
          />
        )}

        {(kind === "plain" || kind === "pdf" || kind === "chatgpt" || kind === "folder") && (
          <div className="space-y-1">
            <label htmlFor="source-name" className="text-xs font-semibold text-muted">Source label</label>
            <input
              id="source-name"
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder={
                kind === "plain" ? "e.g. Paste · pricing notes" :
                kind === "folder" ? "Folder name" :
                kind === "pdf" ? "e.g. whitepaper.pdf" : "e.g. conversations.json"
              }
              className={inputCls}
              disabled={busy}
            />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="intent" className="text-xs font-semibold text-muted">Intent <span className="font-normal text-faint">(optional, never inferred)</span></label>
          <input
            id="intent"
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Why is this context being captured?"
            className={inputCls}
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="labels" className="text-xs font-semibold text-muted">Labels <span className="font-normal text-faint">(comma-separated)</span></label>
          <input
            id="labels"
            type="text"
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            placeholder="docs, reference, design"
            className={inputCls}
            disabled={busy}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="button" className={btnPrimary} onClick={() => onSubmit(build)} disabled={busy || !canSubmit}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy ? "Capturing…" : "Capture"}
            {!busy && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
          {kind === "folder" && files.length > 0 && (
            <span className="text-xs font-medium text-faint">per-file SHA-256 hashes will be computed</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ---------- Small helpers ---------- */

function webkitPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

function folderRootName(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return "folder";
  const parts = rel.split("/");
  return parts[0] || "folder";
}

function FilePicker({
  label,
  accept,
  multiple,
  directory,
  files,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  files: File[];
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  hint?: string;
}) {
  const dirProps = directory
    ? ({ webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>)
    : undefined;

  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted">{label}</label>
      <label
        className={`flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong/70 bg-surface-muted/40 px-4 py-6 text-sm font-medium text-muted transition-colors hover:border-primary/50 hover:text-foreground ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      >
        <FolderOpen className="h-4 w-4 text-primary" aria-hidden="true" />
        {files.length === 0 ? "Click to choose files…" : `${files.length} file${files.length === 1 ? "" : "s"} selected`}
        <input
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          {...dirProps}
          onChange={onChange}
          disabled={disabled}
        />
      </label>
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}