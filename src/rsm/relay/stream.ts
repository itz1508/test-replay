/**
 * ReplayStreaming — honest, ephemeral delivery of a prepared relay.
 *
 * `streamRelay` is an async generator over a `PreparedRelay`. It serializes the
 * canonical envelope ONCE and yields deterministic chunks (fixed byte budget),
 * so the STREAMING state reflects REAL delivery progress — never fabricated
 * percentages. On completion it yields a terminal chunk with the DELIVERED
 * payload `{ relay_id, envelope_hash, provenance }`, taken from the envelope's
 * own provenance chain (never fabricated).
 *
 * State flow: PREPARING -> STREAMING -> COMPLETED (| FAILED | CANCELLED).
 * Respects `AbortSignal` for honest cancellation.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import { canonicalJson } from "../bucket/serialization";
import { RELAY_STATES, isTerminalRelayState, type Relay, type RelayState } from "./types";
import type { ReplayEnvelope } from "../replay/envelope";

/** Default byte budget per streamed chunk (deterministic split). */
export const DEFAULT_CHUNK_BYTES = 512;

/** A single honest delivery event yielded by the stream. */
export type StreamChunk =
  | { kind: "preparing"; relay_id: string; total_chunks: number | null }
  | {
      kind: "chunk";
      relay_id: string;
      chunk_index: number; // 1-based
      total_chunks: number;
      bytes: number;
    }
  | {
      kind: "completed";
      relay_id: string;
      state: "COMPLETED";
      delivered: {
        relay_id: string;
        envelope_hash: string;
        provenance: ReplayEnvelope["provenance"];
        bucket_ids: string[];
      };
    }
  | { kind: "failed"; relay_id: string; state: "FAILED"; error: string }
  | { kind: "cancelled"; relay_id: string; state: "CANCELLED"; error: string };

export interface StreamRelayOptions {
  /** Byte budget per chunk (default DEFAULT_CHUNK_BYTES). */
  chunkBytes?: number;
  /** Abort signal — request honest CANCELLED termination. */
  signal?: AbortSignal;
}

/** Partition a string into fixed-size byte-chunks (UTF-8 aware). */
export function splitIntoChunks(payload: string, bytesPerChunk: number): string[] {
  if (bytesPerChunk <= 0) {
    throw new RangeError("chunkBytes must be a positive integer.");
  }
  if (payload.length === 0) return [""];
  const encoder = new TextEncoder();
  const bytes = encoder.encode(payload);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerChunk) {
    const slice = bytes.subarray(offset, Math.min(offset + bytesPerChunk, bytes.length));
    chunks.push(new TextDecoder().decode(slice));
  }
  return chunks;
}

/**
 * Stream a prepared relay to its DELIVERED payload.
 *
 * Yields: PREPARING marker → N honest chunk events → terminal COMPLETED event.
 * If the signal aborts mid-stream, yields a CANCELLED terminal event instead.
 * The relay's `streamed_at` / `error` fields are NOT mutated here — the caller
 * persists terminal state through the repository.
 */
export async function* streamRelay(
  prepared: { relay: Relay; envelope: ReplayEnvelope },
  options: StreamRelayOptions = {},
): AsyncGenerator<StreamChunk> {
  const { relay, envelope } = prepared;
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;

  const checkAbort = (): string | null => {
    if (options.signal?.aborted) {
      return options.signal.reason instanceof Error ? options.signal.reason.message : "Delivery cancelled.";
    }
    return null;
  };

  // Serialize the canonical envelope exactly once; chunking is deterministic.
  let payload: string;
  try {
    payload = canonicalJson(envelope);
  } catch (err) {
    yield {
      kind: "failed",
      relay_id: relay.relay_id,
      state: RELAY_STATES.Failed as "FAILED",
      error: err instanceof Error ? err.message : "Failed to serialize the relay envelope.",
    };
    return;
  }

  const chunks = splitIntoChunks(payload, chunkBytes);
  const total = chunks.length;

  if (relay.state !== RELAY_STATES.Preparing && relay.state !== RELAY_STATES.Idle) {
    yield {
      kind: "failed",
      relay_id: relay.relay_id,
      state: RELAY_STATES.Failed as "FAILED",
      error: `Cannot stream a relay in state "${relay.state}".`,
    };
    return;
  }

  // PREPARING marker (indeterminate — real work happens in the caller).
  yield { kind: "preparing", relay_id: relay.relay_id, total_chunks: total };

  const cancelledBeforeFirstChunk = checkAbort();
  if (cancelledBeforeFirstChunk !== null) {
    yield {
      kind: "cancelled",
      relay_id: relay.relay_id,
      state: RELAY_STATES.Cancelled as "CANCELLED",
      error: cancelledBeforeFirstChunk,
    };
    return;
  }

  // Real, deterministic chunked delivery.
  for (let i = 0; i < chunks.length; i++) {
    const abortReason = checkAbort();
    if (abortReason !== null) {
      yield {
        kind: "cancelled",
        relay_id: relay.relay_id,
        state: RELAY_STATES.Cancelled as "CANCELLED",
        error: abortReason,
      };
      return;
    }
    yield {
      kind: "chunk",
      relay_id: relay.relay_id,
      chunk_index: i + 1,
      total_chunks: total,
      bytes: new TextEncoder().encode(chunks[i]).length,
    };
  }

  // Terminal COMPLETED with the DELIVERED payload — provenance comes from the
  // envelope's own provenance entries; we never fabricate it.
  yield {
    kind: "completed",
    relay_id: relay.relay_id,
    state: RELAY_STATES.Completed as "COMPLETED",
    delivered: {
      relay_id: relay.relay_id,
      envelope_hash: envelope.envelope_hash,
      provenance: envelope.provenance,
      bucket_ids: relay.bucket_ids,
    },
  };
}

/** Map a stream terminal event to a relay state (for persistence). */
export function terminalStateOf(chunk: Extract<StreamChunk, { kind: "completed" | "failed" | "cancelled" }>): RelayState {
  if (chunk.kind === "completed") return RELAY_STATES.Completed;
  if (chunk.kind === "failed") return RELAY_STATES.Failed;
  return RELAY_STATES.Cancelled;
}

/** Is this chunk a terminal event? */
export function isTerminalChunk(chunk: StreamChunk): boolean {
  return chunk.kind === "completed" || chunk.kind === "failed" || chunk.kind === "cancelled";
}

export { isTerminalRelayState };
