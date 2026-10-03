/**
 * Extraction pipeline — extractors (one per source type) + orchestrator.
 *
 * The orchestrator turns an `ExtractedSource` into a CAPTURED bucket and runs
 * the deterministic lifecycle chain CAPTURED → VERIFIED → STORED → READY,
 * validating every transition against the lifecycle state machine
 * (lifecycle/state-machine.ts). The repository (persistence boundary) is
 * injected — extraction never touches storage directly.
 *
 * Pure TypeScript — no AI, no Vite, no Supabase.
 */

import { RsmError } from "../errors";
import { createBucket } from "../bucket/create";
import type { Bucket, SourceOrigin } from "../bucket/types";
import { createProvenance } from "../provenance/create";
import { verifyBucket } from "../integrity/verify";
import { ingestEvent, transitionBucket } from "../lifecycle/state-machine";
import type { LifecycleEvent } from "../lifecycle/types";
import type { RsmRepository } from "../persistence/types";
import type { ExtractedSource } from "./types";

export type { ExtractedSource };

/** Canonical ingestion method label derived from the extracted source. */
export function ingestionMethodFor(extracted: ExtractedSource): string {
  switch (extracted.source_type) {
    case "markdown":
    case "pdf":
    case "binary":
      return "file_upload";
    case "txt":
    case "pasted_text":
      return extracted.source_origin === "paste" ? "paste" : "file_upload";
    case "chatgpt_export":
      return "chatgpt_export";
    case "folder":
      return "folder_ingest";
    default:
      return "file_upload";
  }
}

export interface IngestOptions {
  /** User-supplied intent (never inferred). */
  intent?: string | null;
  /** Labels applied at ingest. */
  labels?: string[];
  /** Provenance capture tool label; defaults to "rsm-core". */
  tool?: string;
}

export interface IngestResult {
  /** The bucket, advanced all the way to READY. */
  bucket: Bucket;
  /** Full append-only lifecycle events (INGEST, CAPTURE, STORE, READY). */
  events: LifecycleEvent[];
}

/**
 * Run one extracted source through CAPTURED → VERIFIED → STORED → READY.
 *
 * Every transition is validated by the lifecycle state machine; invalid
 * transitions throw `INVALID_TRANSITION`. STORE's `persisted` proof is the
 * repository write; READY's `ready` proof is extraction completion. The
 * pipeline never auto-activates — the bucket waits in READY (AC-4).
 */
export async function ingestExtracted(
  extracted: ExtractedSource,
  repo: RsmRepository,
  options: IngestOptions = {},
): Promise<IngestResult> {
  // 1. CAPTURED — build the bucket from extracted identity/provenance/content.
  const bucket = await createBucket({
    source: extracted.source,
    source_type: extracted.source_type,
    source_origin: extracted.source_origin as SourceOrigin,
    intent: options.intent ?? null,
    provenance: createProvenance({
      origin: extracted.source,
      ingestion_method: ingestionMethodFor(extracted),
      sourceName: extracted.source,
      sourcePath: extracted.source_path ?? null,
      sourceType: extracted.source_type,
      sizeBytes: extracted.sizeBytes,
      mimeType: extracted.mime_type ?? null,
      sourceChain: extracted.source_chain ?? [],
      captureContext: {
        environment: typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined" ? "browser" : "node",
        tool: options.tool ?? "rsm-core",
        ...(extracted.capture_note !== undefined ? { note: extracted.capture_note } : {}),
      },
    }),
    full_content: extracted.full_content,
    labels: options.labels ?? [],
    metadata: extracted.metadata ?? {},
  });

  // 2. Bind the integrity fingerprint (hash + VALID) — VERIFY precondition.
  const verified = await verifyBucket(bucket);
  const verifyTransition = transitionBucket(verified.bucket, "VERIFY", {
    actor: "system",
    reason: "Extraction complete; deterministic fingerprint bound and integrity VALID.",
  });
  const earlyEvents: LifecycleEvent[] = [
    ingestEvent(bucket, { actor: "system", reason: "Source captured by ingestion pipeline." }),
    verifyTransition.event,
  ];

  // 3. STORE — durable write acknowledged by the repository itself.
  await repo.saveBucketWithEvents(verifyTransition.bucket, earlyEvents); // authoritative state now persisted
  const storeTransition = transitionBucket(verifyTransition.bucket, "STORE", {
    actor: "system",
    persisted: true,
    reason: "Bucket durably persisted by repository.",
  });

  // 4. READY — extraction/normalization confirmed; no automatic activation.
  const readyTransition = transitionBucket(storeTransition.bucket, "READY", {
    actor: "system",
    ready: true,
    reason: "Ingest pipeline complete; bucket READY. Activation is explicit — never automatic (AC-4).",
  });

  const events: LifecycleEvent[] = [...earlyEvents, storeTransition.event, readyTransition.event];
  await repo.saveBucketWithEvents(readyTransition.bucket, events); // final atomic write
  return { bucket: readyTransition.bucket, events };
}

export interface IngestManyResult {
  bucket: Bucket;
  events: LifecycleEvent[];
}

/**
 * Ingest multiple extracted sources (e.g. one per ChatGPT conversation).
 * Failed buckets are reported per-item (they do not abort the batch).
 */
export async function ingestMany(
  extractions: ExtractedSource[],
  repo: RsmRepository,
  options: IngestOptions = {},
): Promise<{ successes: IngestManyResult[]; failures: { source: string; error: RsmError | Error }[] }> {
  const successes: IngestManyResult[] = [];
  const failures: { source: string; error: RsmError | Error }[] = [];
  for (const extracted of extractions) {
    try {
      successes.push(await ingestExtracted(extracted, repo, options));
    } catch (error) {
      failures.push({ source: extracted.source, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return { successes, failures };
}

/* ---------- Barrel: extractors + shared contracts ---------- */

export * from "./types";
export * from "./text";
export * from "./markdown";
export * from "./chatgpt";
export * from "./pdf";
export * from "./folder";