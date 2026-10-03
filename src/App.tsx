/**
 * RSM shell — sidebar + routed views.
 *
 * All business logic lives below in src/rsm; this component only wires the
 * store hook to the four views (List ↔ Detail, Ingest, Replay).
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useRsmStore } from "./hooks/useRsm";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { BucketList } from "./components/BucketList";
import { BucketDetail } from "./components/BucketDetail";
import { IngestView } from "./components/IngestView";
import { ReplayView } from "./components/ReplayView";
import { Spinner, btnSecondary } from "./components/ui";

export default function App() {
  const store = useRsmStore();
  const [view, setView] = useState<ViewId>("buckets");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const navigate = (v: ViewId) => {
    setView(v);
    setSelectedId(null);
  };

  const selectedBucket = selectedId ? store.buckets.find((b) => b.bucket_id === selectedId) ?? null : null;

  let body: ReactNode;
  if (!store.ready && !store.error) {
    body = (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-muted">
          <Spinner className="h-5 w-5" />
          <span className="text-sm font-medium">Opening local store…</span>
        </div>
      </div>
    );
  } else if (store.error) {
    body = (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-destructive/30 bg-destructive-soft p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
          <h1 className="mt-3 font-heading text-lg font-bold text-foreground">Couldn't start RSM</h1>
          <p className="mt-1 text-sm text-muted">{store.error}</p>
          <button type="button" className={`${btnSecondary} mt-4`} onClick={() => store.refresh()}>
            Retry
        </button>
        </div>
      </div>
    );
  } else if (view === "buckets") {
    body = selectedBucket ? (
      <BucketDetail bucket={selectedBucket} store={store} onBack={() => setSelectedId(null)} />
    ) : (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold text-foreground">Buckets</h1>
            <p className="mt-1 text-sm text-muted">
              Every captured piece of external context, with provenance, integrity, and lifecycle.
            </p>
          </div>
          <button type="button" className={btnSecondary} onClick={() => navigate("ingest")}>
            + New ingest
          </button>
        </div>
        <BucketList buckets={store.buckets} onSelect={(b) => setSelectedId(b.bucket_id)} onNavigate={navigate} />
      </div>
    );
  } else if (view === "ingest") {
    body = <IngestView store={store} />;
  } else {
    body = <ReplayView store={store} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar view={view} onNavigate={navigate} buckets={store.buckets} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">{body}</div>
      </main>
    </div>
  );
}