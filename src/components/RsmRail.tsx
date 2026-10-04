/**
 * RSM rail — compact right-side delivery surface (Phase D).
 *
 * Shows the fail-closed conversation state: RSM ON/OFF switch, the source set
 * (ready buckets), the selected bucket's representation + snapshot readiness,
 * a Replay button, and the last relay status. Renders REAL repo data only —
 * every number comes from `store.buckets` / `store.conversation` / relay
 * state, never fabricated. All authorization decisions stay in
 * `src/rsm/relay/gate.ts`; this panel only reflects them.
 */
import { useMemo, type RefObject } from "react";
import { AlertTriangle, Lock, Play, Radio, ShieldCheck } from "lucide-react";
import type { RsmStore } from "../hooks/useRsm";
import { isReplayable } from "../rsm/replay/envelope";
import type { Bucket } from "../rsm/bucket/types";
import { shortId, timeAgo } from "../lib/format";
import { Badge, SourceGlyph, Spinner, StateBadge, btnPrimary } from "./ui";

/** Human label per preserved representation (full content is never flattened). */
const REPRESENTATION_LABELS: Record<Bucket["full_content"]["kind"], string> = {
  text: "Text (verbatim)",
  conversation: "Conversation (structured)",
  folder: "Folder (per-file)",
  opaque: "Opaque (binary ref)",
};

export function RsmRail({
  store,
  replayTriggerRef,
}: {
  store: RsmStore;
  /** Ref of the Replay button so the ephemeral surface can return focus. */
  replayTriggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { buckets, conversation } = store;

  // Snapshot-ready sources = READY + RELEASED buckets (real repo state).
  const replayable = useMemo(() => buckets.filter((b) => isReplayable(b)), [buckets]);
  const selected = useMemo(() => {
    const id = conversation?.selected_bucket_id ?? null;
    return id ? (buckets.find((b) => b.bucket_id === id) ?? null) : null;
  }, [buckets, conversation]);

  const readyCount = buckets.filter((b) => b.lifecycle_state === "READY").length;
  const releasedCount = buckets.filter((b) => b.lifecycle_state === "RELEASED").length;
  const enabled = conversation?.rsm_enabled === true;
  const inFlight = store.deliveryActive;
  const canReplay = enabled && !!selected && !inFlight;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-border bg-surface lg:w-72" aria-label="RSM delivery">
      {/* Header + fail-closed switch */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="leading-tight">
          <p className="font-heading text-sm font-extrabold text-foreground">RSM delivery</p>
          <p className="text-[11px] font-medium text-muted">fail-closed · source-gated</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "RSM is on. Turn off fail-closed delivery." : "RSM is off. Turn on delivery."}
          onClick={() => void store.toggleRsm(!enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ease-out ${
            enabled ? "bg-primary" : "bg-border-strong"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* ---- Status line (real gate/history state) ---- */}
        {deliveryStatus(store, inFlight)}

        {/* ---- Source set ---- */}
        <section aria-labelledby="rsm-sources-title">
          <div className="flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
            <h3 id="rsm-sources-title" className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              Source set
            </h3>
            <span className="ml-auto font-mono text-[11px] font-semibold text-muted">{buckets.length}</span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-faint">
            {readyCount} ready · {releasedCount} released
          </p>

          {replayable.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border-strong/60 bg-surface-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted">
              No READY or RELEASED buckets yet. Stage content in{" "}
              <span className="font-semibold text-foreground">Ingest</span> — it appears here the moment it's ready.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Delivery source" className="mt-2 space-y-1">
              {replayable.map((b) => {
                const isSel = selected?.bucket_id === b.bucket_id;
                return (
                  <label
                    key={b.bucket_id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all duration-150 ease-out active:scale-[0.99] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2 ${
                      isSel
                        ? "border-primary/40 bg-primary-soft/60"
                        : "border-border bg-surface hover:border-border-strong hover:bg-surface-muted"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rsm-source"
                      className="sr-only"
                      checked={isSel}
                      onChange={() => void store.selectBucket(b.bucket_id)}
                    />
                    <SourceGlyph type={b.source_type} className={isSel ? "text-primary" : "text-faint"} />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={b.source}>
                      {b.source}
                    </span>
                    <StateBadge state={b.lifecycle_state} />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- Selected source: representation + snapshot readiness ---- */}
        {selected && (
          <section
            aria-label="Selected source details"
            className="space-y-2 rounded-lg border border-border bg-surface-muted/40 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Snapshot</span>
              <StateBadge state={selected.lifecycle_state} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Representation</span>
              <Badge tone="success">PRESERVED</Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              {REPRESENTATION_LABELS[selected.full_content.kind]} — the original content is kept intact, never flattened.
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Fingerprint</span>
              <span className="font-mono text-[11px] text-muted">{shortId(selected.hash ?? selected.bucket_id, 12)}</span>
            </div>
          </section>
        )}
      </div>

      {/* ---- Replay action ---- */}
      <footer className="space-y-2 border-t border-border px-4 py-3">
        <button
          ref={replayTriggerRef}
          type="button"
          disabled={!canReplay}
          onClick={() => void store.replayOnce()}
          className={`${btnPrimary} w-full`}
        >
          {inFlight ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {inFlight ? "Delivering…" : "Replay envelope"}
        </button>
        {!enabled && <p className="text-center text-[11px] text-faint">Turn RSM on to release this session's context.</p>}
      </footer>
    </aside>
  );
}

/** Honest last-line status (gate results & real relay history). */
function deliveryStatus(store: RsmStore, inFlight: boolean) {
  if (inFlight) {
    const p = store.deliveryProgress;
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs text-info"
      >
        <Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {p ? `Streaming chunk ${p.chunk_index} of ${p.total_chunks}` : "Preparing the envelope…"} — the canonical
          envelope is being delivered to this session.
        </span>
      </div>
    );
  }

  if (store.lastRelayError) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-xs text-destructive"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{store.lastRelayError}</span>
      </div>
    );
  }

  if (!store.conversation) {
    return (
      <p role="status" className="text-xs text-muted">
        Opening delivery state…
      </p>
    );
  }

  if (!store.conversation.rsm_enabled) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-xs text-muted">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span>
          RSM is <span className="font-semibold">OFF</span>. No context is released until this session switches on
          delivery.
        </span>
      </div>
    );
  }

  if (!store.conversation.selected_bucket_id) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true" />
        <span>RSM is ON, but no source is selected — deliveries stay closed until you pick one.</span>
      </div>
    );
  }

  const last = store.lastRelay;
  if (last) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-xs text-success"
      >
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Delivered {timeAgo(last.streamed_at ?? last.created_at)} ·{" "}
          <span className="font-mono">{shortId(last.snapshot?.envelope_hash ?? last.relay_id, 12)}</span>
        </span>
      </div>
    );
  }

  return (
    <p role="status" className="text-xs text-muted">
      Ready — this session's context can be delivered.
    </p>
  );
}