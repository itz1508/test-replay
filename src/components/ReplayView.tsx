/**
 * Replay view — build and export READ-ONLY context envelopes.
 *
 * Replay NEVER mutates buckets: it selects eligible ones (READY / RELEASED),
 * fingerprints the selection into an envelope with provenance, and exposes the
 * canonical JSON export. Consumption and the envelope itself are read-only.
 */
import { useCallback, useMemo, useState } from "react";
import { Download, Play, ShieldCheck, Sparkles } from "lucide-react";
import * as rsm from "../rsm";
import type { ReplayEnvelope } from "../rsm/replay/envelope";
import type { RsmStore } from "../hooks/useRsm";
import { formatDateTime, shortId } from "../lib/format";
import {
  EmptyState,
  Panel,
  Spinner,
  StateBadge,
  btnGhost,
  btnPrimary,
  downloadText,
} from "./ui";

export function ReplayView({ store }: { store: RsmStore }) {
  const [busy, setBusy] = useState(false);
  const [envelope, setEnvelope] = useState<ReplayEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = useMemo(() => store.buckets.filter((b) => rsm.replay.isReplayable(b)), [store.buckets]);
  const readyCount = store.buckets.filter((b) => b.lifecycle_state === "READY").length;
  const releasedCount = store.buckets.filter((b) => b.lifecycle_state === "RELEASED").length;

  const buildEnvelope = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const env = await rsm.replay.createReplayEnvelope(store.buckets);
      setEnvelope(env);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the replay envelope.");
    } finally {
      setBusy(false);
    }
  }, [store.buckets]);

  const exportEnvelope = useCallback(() => {
    if (!envelope) return;
    const exp = rsm.transports.exportEnvelope(envelope);
    downloadText(exp.filename, exp.json);
  }, [envelope]);

  const exportAll = useCallback(() => {
    const exp = rsm.transports.exportBuckets(eligible);
    downloadText(exp.filename, exp.json);
  }, [eligible]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-foreground">Replay</h1>
        <p className="mt-1 text-sm text-muted">
          Build a read-only context envelope from staged buckets. Replay never mutates buckets —
          it bundles them with provenance and a fingerprint for downstream consumption.
        </p>
      </div>

      {/* Status summary */}
      <Panel title="Eligible context">
        <div className="flex flex-wrap items-center gap-3">
          <Stat label="READY" value={readyCount} />
          <Stat label="RELEASED" value={releasedCount} />
          <Stat label="In envelope" value={eligible.length} />
          <div className="ml-auto">
            <button type="button" className={btnPrimary} onClick={buildEnvelope} disabled={busy || eligible.length === 0}>
              {busy ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {busy ? "Building…" : "Build replay envelope"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          Only <span className="font-medium text-muted">READY</span> and{" "}
          <span className="font-medium text-muted">RELEASED</span> buckets are eligible. CAPTURED,
          VERIFIED, and STORED buckets must be advanced first.
        </p>
      </Panel>

      {eligible.length === 0 && (
        <EmptyState
          icon={Sparkles}
          title="Nothing ready to replay"
          body="Capture some context in Ingest first — every captured bucket is verified, stored, and marked READY automatically."
        />
      )}

      {error && <ErrorNote message={error} />}

      {envelope && <EnvelopePanel envelope={envelope} onExportEnvelope={exportEnvelope} onExportBuckets={exportAll} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/60 px-3 py-1.5">
      <div className="font-heading text-lg font-extrabold text-foreground">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

function EnvelopePanel({
  envelope,
  onExportEnvelope,
  onExportBuckets,
}: {
  envelope: ReplayEnvelope;
  onExportEnvelope: () => void;
  onExportBuckets: () => void;
}) {
  return (
    <Panel
      title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Replay envelope</span>}
      actions={
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={onExportEnvelope}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Envelope JSON
          </button>
          <button type="button" className={btnGhost} onClick={onExportBuckets}>
            <Download className="h-4 w-4" aria-hidden="true" />
            All buckets
          </button>
        </div>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Meta label="Replay ID" mono>{shortId(envelope.replay_id, 16)}</Meta>
        <Meta label="Created">{formatDateTime(envelope.created_at)}</Meta>
        <Meta label="Envelope hash" mono>{shortId(envelope.envelope_hash, 16)}</Meta>
        <Meta label="States">{envelope.states.join(", ")}</Meta>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          <tr>
            <th className="py-2">Bucket</th>
            <th className="py-2">State</th>
            <th className="py-2">Hash</th>
            <th className="py-2">Captured</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {envelope.provenance.map((entry) => (
            <tr key={entry.bucket_id}>
              <td className="py-2">
                <div className="font-medium text-foreground">{entry.source}</div>
                <div className="font-mono text-[11px] text-faint">{shortId(entry.bucket_id, 12)}</div>
              </td>
              <td className="py-2"><StateBadge state={entry.lifecycle_state} /></td>
              <td className="py-2 font-mono text-[11px] text-faint">{entry.hash ? shortId(entry.hash, 14) : "—"}</td>
              <td className="py-2 text-faint">{formatDateTime(entry.captured_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-faint">
        The envelope is immutable: any change to bucket content invalidates its hash before it ever
        reaches the LLM. Replay stays read-only.
      </p>
    </Panel>
  );
}

function Meta({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      <span className={`text-foreground ${mono ? "font-mono text-xs" : "font-medium"}`}>{children}</span>
    </div>
  );
}