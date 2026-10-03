/**
 * Bucket detail — full inspection of one bucket.
 *
 * Header with name/badges/actions, meta grid, lifecycle section (next legal
 * actions), content preview, and append-only event log.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ClipboardCopy, Download, Trash2 } from "lucide-react";
import * as rsm from "../rsm";
import type { Bucket } from "../rsm/bucket/types";
import type { LifecycleAction, LifecycleEvent } from "../rsm/lifecycle/types";
import type { RsmStore } from "../hooks/useRsm";
import { formatDateTime, shortId, formatBytes } from "../lib/format";
import { ContentView } from "./ContentView";
import {
  Badge,
  IntegrityBadge,
  StateBadge,
  SourceGlyph,
  SOURCE_LABELS,
  Panel,
  Spinner,
  btnGhost,
  btnIcon,
  btnSecondary,
  downloadText,
  ConfirmDialog,
  Toast,
} from "./ui";

const ACTION_META: Record<string, { label: string; description: string }> = {
  VERIFY: { label: "Verify integrity", description: "Check that content still matches its SHA-256 fingerprint." },
  STORE: { label: "Store", description: "Mark as durably persisted." },
  READY: { label: "Ready", description: "Confirm extraction is complete and bucket is ready for replay." },
  ACTIVE: { label: "Activate", description: "Move to active for replay." },
  RELEASE: { label: "Release", description: "Release the bucket, completing its active window." },
  CLOSE: { label: "Close", description: "Close the bucket permanently." },
};

export function BucketDetail({
  bucket,
  store,
  onBack,
}: {
  bucket: Bucket;
  store: RsmStore;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  // Load events on mount + when bucket state changes (re-verify updates)
  useEffect(() => {
    store.getEvents(bucket.bucket_id).then(setEvents).catch(() => {});
  }, [bucket.bucket_id, bucket.lifecycle_state, store]);

  const legalActions = useMemo(
    () => rsm.lifecycle.legalActionsFor(bucket.lifecycle_state),
    [bucket.lifecycle_state],
  );

  const handleAction = useCallback(
    async (action: LifecycleAction) => {
      setBusy(action);
      try {
        if (action === "VERIFY") {
          const result = await store.verifyAndAdvance(bucket, "Re-verified via Bucket Detail.");
          setToast(result.ok ? { kind: "success", message: result.message } : { kind: "error", message: result.message });
        } else {
          const next = await store.advance(bucket, action);
          setToast({ kind: "success", message: `Bucket is now ${next.lifecycle_state}.` });
        }
        setEvents(await store.getEvents(bucket.bucket_id));
        await store.refresh();
      } catch (err) {
        setToast({ kind: "error", message: err instanceof rsm.RsmError ? err.message : "Something went wrong." });
      } finally {
        setBusy(null);
      }
    },
    [bucket, store],
  );

  const handleExport = useCallback(() => {
    const data = rsm.transports.exportBucket(bucket);
    downloadText(`bucket-${shortId(bucket.bucket_id, 12)}.json`, JSON.stringify(data, null, 2));
  }, [bucket]);

  const handleDelete = useCallback(async () => {
    setShowDelete(false);
    setBusy("CLOSE" as LifecycleAction); // use busy indicator
    try {
      await store.remove(bucket);
      onBack();
    } catch {
      setToast({ kind: "error", message: "Could not delete the bucket." });
    } finally {
      setBusy(null);
    }
  }, [bucket, store, onBack]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(bucket.bucket_id).then(() => {
      setToast({ kind: "success", message: "Bucket ID copied." });
    }, () => {});
  }, [bucket.bucket_id]);

  const contentSize =
    bucket.full_content.kind === "text"
      ? formatBytes(new TextEncoder().encode(bucket.full_content.text).length)
      : bucket.full_content.kind === "conversation"
        ? `${bucket.full_content.conversation.messages.length} messages`
        : bucket.full_content.kind === "folder"
          ? `${bucket.full_content.entries.length} entries`
          : formatBytes(Math.round(bucket.full_content.bytes.length * 0.75));

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={btnGhost}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleExport} className={btnGhost} title="Export as JSON">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </button>
          <button type="button" onClick={() => setShowDelete(true)} className={btnGhost} title="Delete bucket">
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>

      {/* Title + badges */}
      <div className="flex flex-wrap items-center gap-2">
        <SourceGlyph type={bucket.source_type} />
        <h1 className="font-heading text-xl font-extrabold text-foreground truncate">{bucket.source}</h1>
        <StateBadge state={bucket.lifecycle_state} />
        <IntegrityBadge bucket={bucket} />
      </div>

      {/* Meta grid */}
      <Panel title="Identity & Provenance">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <MetaRow label="Bucket ID" mono>
            {shortId(bucket.bucket_id, 16)}
            <button type="button" onClick={handleCopyId} className={btnIcon} aria-label="Copy bucket ID">
              <ClipboardCopy className="h-3 w-3" />
            </button>
          </MetaRow>
          <MetaRow label="Source type">{SOURCE_LABELS[bucket.source_type]}</MetaRow>
          <MetaRow label="Source origin">{bucket.source_origin}</MetaRow>
          <MetaRow label="Content size">{contentSize}</MetaRow>
          <MetaRow label="Created">{formatDateTime(bucket.created_timestamp)}</MetaRow>
          <MetaRow label="SHA-256 (hex)" mono>{shortId(bucket.hash, 20)}</MetaRow>
          <MetaRow label="Schema version">{bucket.schema_version}</MetaRow>
          <MetaRow label="Intent">{bucket.intent ?? "—"}</MetaRow>
        </div>
        {bucket.labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {bucket.labels.map((l) => (
              <Badge key={l} tone="neutral">{l}</Badge>
            ))}
          </div>
        )}
      </Panel>

      {/* Lifecycle */}
      <Panel
        title="Lifecycle"
        actions={
          <span className="text-[11px] font-medium text-faint">
            {legalActions.length === 0
              ? "No further transitions available."
              : `Available: ${legalActions.length}`}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge state={bucket.lifecycle_state} />
          {legalActions.map((action) => {
            const meta = ACTION_META[action] ?? { label: action, description: action };
            return (
              <button
                key={action}
                type="button"
                className={btnSecondary}
                onClick={() => handleAction(action)}
                disabled={busy !== null}
              >
                {busy === action && <Spinner className="h-3.5 w-3.5" />}
                {meta.label}
              </button>
            );
          })}
        </div>
        {bucket.lifecycle_state !== "READY" && (
          <p className="mt-2 text-xs text-faint">
            {bucket.lifecycle_state === "CAPTURED" && "Freshly captured. Verify integrity before staging."}
            {bucket.lifecycle_state === "VERIFIED" && "Integrity confirmed. Store to make durable."}
            {bucket.lifecycle_state === "STORED" && "Durably stored. Mark ready for replay."}
            {bucket.lifecycle_state === "ACTIVE" && "In active use. Release when done."}
            {bucket.lifecycle_state === "RELEASED" && "Released. Close to archive."}
            {bucket.lifecycle_state === "CLOSED" && "Closed. No further transitions."}
          </p>
        )}
      </Panel>

      {/* Content */}
      <Panel title="Content">
        <ContentView bucket={bucket} />
      </Panel>

      {/* Events */}
      <Panel
        title="Event Log"
        actions={
          <span className="text-[11px] font-medium text-faint">{events.length} events</span>
        }
      >
        {events.length === 0 ? (
          <p className="text-sm text-muted">No events recorded.</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-auto">
            {events.map((evt, i) => (
              <div
                key={evt.event_id ?? i}
                className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs"
              >
                <span className="shrink-0 font-mono text-faint">
                  {evt.timestamp ? new Date(evt.timestamp).toLocaleString() : "—"}
                </span>
                <span className="shrink-0 font-semibold text-foreground">{evt.event_type}</span>
                <span className="text-muted truncate">{evt.reason ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Confirm delete */}
      {showDelete && (
        <ConfirmDialog
          title="Delete bucket"
          body={
            <p>
              This permanently removes <strong>{bucket.source}</strong> and its entire event history from the local store.
              This cannot be undone.
            </p>
          }
          confirmLabel="Delete permanently"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
          <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-faint">{label}</span>
      <span className={`text-foreground ${mono ? "font-mono text-xs" : "font-medium"}`}>{children}</span>
    </div>
  );
}