/**
 * PROCESSOR — canonical prepared-representation contract.
 *
 * Processor is the CONTROLLED component that transforms OBSERVED source
 * material into a bounded representation suitable for Replay. It may select,
 * filter, order, normalize, deduplicate, chunk, reduce, compress or summarize
 * — but it NEVER executes the user's task, never mutates authoritative Source,
 * and never silently discards material without recording the applicable
 * reduction/coverage information.
 *
 * Frozen boundary:
 *   PROCESSOR = prepare   (what bounded representation should RSM prepare?)
 *   REPLAY    = deliver   (delivery only, no transformation)
 *   AGENT     = reason    (outside RSM — never hosted here)
 *
 * The prepared representation is an implementation/result representation; it is
 * NOT a new major domain hierarchy and NOT a Source. It carries full coverage
 * info so reductions are always recorded, never silent.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { ScanFile } from "../scan/types";
import type { ReaderTrace } from "../reader/types";

/** Reduction method used to produce the bounded representation. */
export type PreparationMethod = "passthrough" | "bounded-reduce" | "unprocessed";

/** Per-file coverage ledger — nothing is discarded silently. */
export interface PreparationCoverageEntry {
  file_id: string;
  /** True when the file's content was included in the prepared representation. */
  included: boolean;
  /** Why it was or wasn't included (always recorded). */
  reason: "full" | "bounded-by-budget" | "unreadable" | "opaque";
}

/**
 * A bounded, prepared representation of observed source material.
 *
 * This is what PROCESSOR hands to REPLAY. It is a value, not a workflow, and
 * it does not become a Source (ingesting output would require an explicit user
 * operation).
 */
export interface PreparedRepresentation {
  /** Deterministic id: `<bucket_id>@<fingerprint of prep inputs>`. */
  prepared_id: string;
  /** Source bucket the representation was prepared from. */
  bucket_id: string;
  /** Final prepared payload (bounded). */
  content: string;
  content_bytes: number;
  /** Coverage ledger — what was observed vs included and why. */
  coverage: PreparationCoverageEntry[];
  method: PreparationMethod;
  /** Budget applied when reducing (bytes). */
  budget_bytes: number | null;
  /** Skip the reason above? No — reasons are always explicit. */
}

export interface PrepareOptions {
  /** Max prepared content bytes (default DEFAULT_PREPARED_BUDGET_BYTES). */
  maxBytes?: number;
}