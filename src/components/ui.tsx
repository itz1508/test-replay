/**
 * Shared UI primitives — badges, empty states, panels, buttons, dialog.
 * Styling follows design-system/MASTER.md tokens (light-first, indigo accent).
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  Clipboard,
  FileText,
  FolderOpen,
  MessageSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Bucket, LifecycleState, SourceType } from "../rsm/bucket/types";
import { integrityTone, lifecycleStateTone } from "../lib/format";

/* ---------- Class presets (consistent key affordances) ---------- */

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary shadow-sm transition-all duration-150 ease-out hover:bg-primary-hover active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm font-semibold text-foreground transition-all duration-150 ease-out hover:bg-surface-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-out hover:brightness-110 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm font-semibold text-muted transition-all duration-150 ease-out hover:bg-surface-muted hover:text-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const btnIcon =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted transition-all duration-150 ease-out hover:bg-surface-muted hover:text-foreground active:scale-95";
export const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50";
export const selectCls = inputCls + " cursor-pointer appearance-none pr-8";

/* ---------- Badges ---------- */

const TONE_CLASSES = {
  neutral: "bg-surface-muted text-muted border-border-strong/40",
  muted: "bg-surface-muted/60 text-faint border-border-strong/30",
  primary: "bg-primary-soft text-primary border-primary/25",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  destructive: "bg-destructive-soft text-destructive border-destructive/25",
  info: "bg-info-soft text-info border-info/25",
} as const;

export type BadgeTone = keyof typeof TONE_CLASSES;

export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tracking-tight ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StateBadge({ state }: { state: LifecycleState }) {
  return (
    <Badge tone={lifecycleStateTone(state)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {state}
    </Badge>
  );
}

export function IntegrityBadge({ bucket }: { bucket: Bucket }) {
  const tone = integrityTone(bucket.integrity_status);
  return <Badge tone={tone}>{bucket.integrity_status}</Badge>;
}

/* ---------- Source identity ---------- */

const SOURCE_ICONS: Record<SourceType, LucideIcon> = {
  markdown: FileText,
  txt: FileText,
  pasted_text: Clipboard,
  chatgpt_export: MessageSquare,
  pdf: FileText,
  folder: FolderOpen,
  binary: FileText,
};

export const SOURCE_LABELS: Record<SourceType, string> = {
  markdown: "Markdown",
  txt: "Text",
  pasted_text: "Paste",
  chatgpt_export: "ChatGPT",
  pdf: "PDF",
  folder: "Folder",
  binary: "Binary",
};

export function SourceGlyph({ type, className = "text-primary" }: { type: SourceType; className?: string }) {
  const Icon = SOURCE_ICONS[type];
  return <Icon className={`h-4 w-4 shrink-0 ${className}`} aria-hidden="true" />;
}

/* ---------- Panels, spinner, empty states ---------- */

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-bold text-foreground">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong/60 bg-surface-muted/50 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="font-heading text-base font-bold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ---------- Actions ---------- */

export function downloadText(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Toast({ kind, message, onDismiss }: { kind: "success" | "error" | "info"; message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(t);
  }, [onDismiss]);
  const tone =
    kind === "success"
      ? "border-success/30 bg-success-soft text-success"
      : kind === "error"
        ? "border-destructive/30 bg-destructive-soft text-destructive"
        : "border-border-strong bg-surface text-foreground";
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium shadow-lg animate-fade-up ${tone}`}
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="ml-1 rounded p-0.5 opacity-70 transition hover:opacity-100" aria-label="Dismiss notification">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ---------- Confirm dialog (accessible: aria-modal, focus trap, Escape) ---------- */

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const els = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px] animate-fade-in"
        onClick={busy ? undefined : onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-xl border border-border-strong bg-surface p-5 shadow-xl animate-pop"
      >
        <h2 id="rsm-dialog-title" className="font-heading text-base font-bold text-foreground">
          {title}
        </h2>
        <div className="mt-1.5 text-sm text-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className={danger ? btnDanger : btnPrimary} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
