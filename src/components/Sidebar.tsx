import { Database, Inbox, Layers, Play } from "lucide-react";
import { useMemo } from "react";
import type { Bucket } from "../rsm/bucket/types";
import { isReplayable } from "../rsm/replay/envelope";
import { Badge } from "./ui";

export type ViewId = "buckets" | "ingest" | "replay";

export function Sidebar({
  view,
  onNavigate,
  buckets,
}: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  buckets: Bucket[];
}) {
  const counts = useMemo(() => {
    const replayable = buckets.filter((b) => isReplayable(b)).length;
    return {
      total: buckets.length,
      replayable,
      ready: buckets.filter((b) => b.lifecycle_state === "READY").length,
    };
  }, [buckets]);

  const items: { id: ViewId; label: string; icon: typeof Layers; count?: number }[] = [
    { id: "buckets", label: "Buckets", icon: Layers, count: counts.total },
    { id: "ingest", label: "Ingest", icon: Inbox, count: undefined },
    { id: "replay", label: "Replay", icon: Play, count: counts.replayable },
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
          <Layers className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="font-heading text-sm font-extrabold text-foreground">RSM</p>
          <p className="text-[11px] font-medium text-muted">Replay State Memory</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-150 ease-out active:scale-[0.98] ${
                active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1 text-left">{item.label}</span>
              {typeof item.count === "number" && (
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    active ? "bg-primary text-on-primary" : "bg-surface-muted text-muted group-hover:bg-border"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border px-4 py-4">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted">
          <Database className="h-3.5 w-3.5" aria-hidden="true" />
          local-first · IndexedDB
        </div>
        <Badge tone="neutral">schema v1</Badge>
        <p className="text-[11px] leading-relaxed text-faint">
          {counts.ready === 0
            ? "No buckets READY yet — stage content in Ingest."
            : `${counts.ready} bucket${counts.ready === 1 ? "" : "s"} ready for replay.`}
        </p>
      </div>
    </aside>
  );
}