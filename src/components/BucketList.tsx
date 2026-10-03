/**
 * Bucket list — all buckets displayed with state badge, source icon, timestamp,
 * labels. Sortable/filterable by source type and lifecycle state.
 */
import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import type { Bucket, LifecycleState, SourceType } from "../rsm/bucket/types";
import { LIFECYCLE_STATES } from "../rsm/bucket/types";
import { timeAgo, shortId, formatBytes } from "../lib/format";
import {
  Badge,
  SourceGlyph,
  SOURCE_LABELS,
  StateBadge,
  IntegrityBadge,
  EmptyState,
  btnGhost,
  btnSecondary,
  inputCls,
  selectCls,
} from "./ui";
import type { ViewId } from "./Sidebar";

const STATE_OPTIONS: LifecycleState[] = Object.values(LIFECYCLE_STATES) as LifecycleState[];

export function BucketList({
  buckets,
  onSelect,
  onNavigate,
}: {
  buckets: Bucket[];
  onSelect: (b: Bucket) => void;
  onNavigate: (v: ViewId) => void;
}) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceType | "all">("all");
  const [stateFilter, setStateFilter] = useState<LifecycleState | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "source">("newest");

  const filtered = useMemo(() => {
    let list = [...buckets];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.source.toLowerCase().includes(q) ||
          b.labels.some((l) => l.toLowerCase().includes(q)) ||
          b.bucket_id.startsWith(q),
      );
    }
    if (sourceFilter !== "all") list = list.filter((b) => b.source_type === sourceFilter);
    if (stateFilter !== "all") list = list.filter((b) => b.lifecycle_state === stateFilter);
    switch (sort) {
      case "newest":
        list.sort((a, b) => b.created_timestamp.localeCompare(a.created_timestamp));
        break;
      case "oldest":
        list.sort((a, b) => a.created_timestamp.localeCompare(b.created_timestamp));
        break;
      case "source":
        list.sort((a, b) => a.source.localeCompare(b.source));
        break;
    }
    return list;
  }, [buckets, search, sourceFilter, stateFilter, sort]);

  const sourceOptions = Object.entries(SOURCE_LABELS) as [SourceType, string][];

  if (buckets.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No buckets yet"
        body="Capture external context by uploading files, pasting text, or importing a ChatGPT export."
        action={
          <button type="button" className={btnSecondary} onClick={() => onNavigate("ingest")}>
            Import context
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by source, labels, or id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputCls} pl-8`}
            aria-label="Filter buckets"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceType | "all")}
          className={selectCls}
          aria-label="Filter by source type"
        >
          <option value="all">All sources</option>
          {sourceOptions.map(([t]) => (
            <option key={t} value={t}>{SOURCE_LABELS[t as SourceType]}</option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as LifecycleState | "all")}
          className={selectCls}
          aria-label="Filter by lifecycle state"
        >
          <option value="all">All states</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className={selectCls}
          aria-label="Sort order"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="source">Source A–Z</option>
        </select>
      </div>

      {/* Row count note */}
      <p className="text-[11px] font-medium text-faint">
        {filtered.length} bucket{filtered.length === 1 ? "" : "s"}
        {(sourceFilter !== "all" || stateFilter !== "all" || search.trim()) &&
          ` filtered`}
      </p>

      {/* Rows */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          body="Try a different filter or search term."
          action={
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setSearch("");
                setSourceFilter("all");
                setStateFilter("all");
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface shadow-sm" role="list">
          {filtered.map((bucket) => (
            <BucketRow key={bucket.bucket_id} bucket={bucket} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function BucketRow({ bucket, onSelect }: { bucket: Bucket; onSelect: (b: Bucket) => void }) {
  const contentSize =
    bucket.full_content.kind === "text"
      ? bucket.full_content.text.length
      : bucket.full_content.kind === "conversation"
        ? bucket.full_content.conversation.messages.length
        : bucket.full_content.kind === "folder"
          ? bucket.full_content.entries.length
          : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(bucket)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted active:bg-surface-muted/80"
      role="listitem"
    >
      <SourceGlyph type={bucket.source_type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{bucket.source}</span>
          <Badge tone="neutral">{SOURCE_LABELS[bucket.source_type]}</Badge>
          {bucket.labels.length > 0 && (
            <span className="hidden sm:inline-flex gap-1">
              {bucket.labels.slice(0, 2).map((l) => (
                <Badge key={l} tone="neutral">{l}</Badge>
              ))}
              {bucket.labels.length > 2 && (
                <Badge tone="neutral">+{bucket.labels.length - 2}</Badge>
              )}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] font-medium text-faint">
          <span>{timeAgo(bucket.created_timestamp)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{shortId(bucket.bucket_id)}</span>
          {contentSize !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {bucket.full_content.kind === "text"
                  ? formatBytes(new TextEncoder().encode(bucket.full_content.text).length)
                  : bucket.full_content.kind === "conversation"
                    ? `${contentSize} msgs`
                    : `${contentSize} files`}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StateBadge state={bucket.lifecycle_state} />
        <IntegrityBadge bucket={bucket} />
      </div>
    </button>
  );
}