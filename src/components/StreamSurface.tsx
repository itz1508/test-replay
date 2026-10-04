/**
 * StreamSurface — ephemeral delivery overlay (ADR-4).
 *
 * A transient dialog that narrates the REAL replay stream:
 *   PREPARING (indeterminate) → STREAMING (honest chunk counter) →
 *   COMPLETED (auto-dismiss) | FAILED | CANCELLED.
 *
 * - `aria-live="polite"` status region for screen readers.
 * - Escape cancels an in-flight delivery, otherwise dismisses.
 * - Focus moves into the panel on open and RETURNS to the trigger on close.
 * - Reduced-motion aware via the app's global `prefers-reduced-motion` rules.
 * - Ephemeral: never persists as a chat message and leaves no residue.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AlertTriangle, Ban, ShieldCheck, X } from "lucide-react";
import * as rsm from "../rsm";
import type { RsmStore } from "../hooks/useRsm";
import { formatBytes, shortId } from "../lib/format";
import { Spinner, btnSecondary } from "./ui";

/** How long a COMPLETED delivery stays visible before auto-dismissing. */
const COMPLETED_VISIBLE_MS = 2400;

export function StreamSurface({
  store,
  triggerRef,
}: {
  store: RsmStore;
  /** Element to restore focus to on close (the rail's Replay button). */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { relayState, deliveryActive, lastRelay, lastRelayError, deliveryProgress, cancelDelivery, resetDelivery } = store;
  const open = relayState !== rsm.relay.RELAY_STATES.Idle;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusToRef = useRef<HTMLElement | null>(null);

  // Focus moves into the panel on open; restored to the trigger on close.
  // Keyed on `open` only so mid-transition re-renders never steal focus.
  useEffect(() => {
    if (!open) return;
    restoreFocusToRef.current = (document.activeElement as HTMLElement | null) ?? triggerRef.current;
    panelRef.current?.focus();
    return () => {
      (restoreFocusToRef.current ?? triggerRef.current)?.focus();
    };
  }, [open, triggerRef]);

  // Escape + auto-dismiss. Deps are state + stable store callbacks only — the
  // store object identity changes every render, so referencing `store` itself
  // here would restart the COMPLETED timer on every paint.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (relayState === rsm.relay.RELAY_STATES.Preparing || relayState === rsm.relay.RELAY_STATES.Streaming) {
        cancelDelivery();
      } else {
        resetDelivery();
      }
    };
    document.addEventListener("keydown", onKey);
    let timer: number | undefined;
    if (relayState === rsm.relay.RELAY_STATES.Completed) {
      timer = window.setTimeout(() => resetDelivery(), COMPLETED_VISIBLE_MS);
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, relayState, cancelDelivery, resetDelivery]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px] animate-fade-in" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rsm-stream-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-xl border border-border-strong bg-surface p-5 shadow-xl animate-pop outline-none"
      >
        <button
          type="button"
          aria-label="Close delivery surface"
          onClick={() => (deliveryActive ? cancelDelivery() : resetDelivery())}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted transition-all duration-150 ease-out hover:bg-surface-muted hover:text-foreground active:scale-95"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* aria-live status region narrates each phase of the real stream. */}
        <div role="status" aria-live="polite">
          {relayState === rsm.relay.RELAY_STATES.Preparing && <PreparingBody />}
          {relayState === rsm.relay.RELAY_STATES.Streaming && <StreamingBody progress={deliveryProgress} />}
          {relayState === rsm.relay.RELAY_STATES.Completed && <CompletedBody relay={lastRelay} />}
          {relayState === rsm.relay.RELAY_STATES.Failed && (
            <TerminalBody
              icon={<AlertTriangle className="h-9 w-9 text-destructive" aria-hidden="true" />}
              title="Delivery failed"
              message={lastRelayError ?? "The envelope could not be delivered."}
              onClose={resetDelivery}
            />
          )}
          {relayState === rsm.relay.RELAY_STATES.Cancelled && (
            <TerminalBody
              icon={<Ban className="h-9 w-9 text-warning" aria-hidden="true" />}
              title="Delivery cancelled"
              message="Stopped before completion — nothing was released to this session."
              onClose={resetDelivery}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PreparingBody() {
  return (
    <div className="flex items-start gap-3">
      <Spinner className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
      <div>
        <h2 id="rsm-stream-title" className="font-heading text-base font-bold text-foreground">
          Preparing the envelope…
        </h2>
        <p className="mt-1 text-sm text-muted">
          Hashing the source and sealing the content fingerprint before anything is released. This session stays closed
          until the deliverable is verified.
        </p>
      </div>
    </div>
  );
}

function StreamingBody({
  progress,
}: {
  progress: { relay_id: string; chunk_index: number; total_chunks: number; bytes: number } | null;
}) {
  const pct = progress && progress.total_chunks > 0 ? Math.round((progress.chunk_index / progress.total_chunks) * 100) : 0;
  return (
    <div>
      <h2 id="rsm-stream-title" className="font-heading text-base font-bold text-foreground">
        Streaming the canonical envelope
      </h2>
      <p className="mt-1 text-sm text-muted">
        {progress
          ? `${formatBytes(progress.bytes)} per chunk · chunk ${progress.chunk_index} of ${progress.total_chunks}`
          : "Serializing the envelope…"}
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" role="presentation" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-faint">
        {pct}% · relay {shortId(progress?.relay_id ?? "", 14)}
      </p>
    </div>
  );
}

function CompletedBody({ relay }: { relay: RsmStore["lastRelay"] }) {
  return (
    <div>
      <ShieldCheck className="h-9 w-9 text-success" aria-hidden="true" />
      <h2 id="rsm-stream-title" className="mt-2 font-heading text-base font-bold text-foreground">
        Context delivered to this session
      </h2>
      <p className="mt-1 text-sm text-muted">
        The envelope reached its destination with its fingerprint intact. This surface closes on its own.
      </p>
      <dl className="mt-3 space-y-1 rounded-lg border border-border bg-surface-muted/60 p-3 font-mono text-[11px]">
        <Row label="relay">{shortId(relay?.relay_id ?? "", 20)}</Row>
        <Row label="hash">{shortId(relay?.snapshot?.envelope_hash ?? "", 22)}</Row>
        <Row label="sources">{relay?.bucket_ids.length ?? 0}</Row>
      </dl>
      <p className="mt-2 text-[11px] text-faint">Nothing else was released — delivery ends here.</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className="truncate text-muted">{children}</dd>
    </div>
  );
}

function TerminalBody({
  icon,
  title,
  message,
  onClose,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div>
      {icon}
      <h2 id="rsm-stream-title" className="mt-2 font-heading text-base font-bold text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}