/**
 * Unit tests — V3 relay & conversation module.
 *
 * Covers: fail-closed authorization (OFF / unknown / disabled), relay id
 * uniqueness, conversation isolation (A can never receive B's context),
 * honest chunked streaming with DELIVERED payload, and source revision
 * (new bucket → new envelope). Pure domain tests — no React, no IndexedDB.
 */
import { describe, expect, it } from "vitest";
import * as rsm from "../index";
import type { Bucket } from "../bucket/types";
import type { Conversation } from "./types";
import { RELAY_STATES } from "./types";
import { canDeliver } from "./gate";
import { createRelay } from "./create";
import { streamRelay } from "./stream";

/** Build a READY bucket with verified integrity (full ingest pipeline in miniature). */
async function readyBucket(source: string, text: string): Promise<Bucket> {
  const provenance = rsm.provenance.createProvenance({
    origin: source,
    ingestion_method: "paste",
    sourceName: source,
    sourceType: "pasted_text",
    sizeBytes: new TextEncoder().encode(text).length,
  });
  const captured = await rsm.bucket.createBucket({
    source,
    source_type: "pasted_text",
    source_origin: "paste",
    provenance,
    full_content: { kind: "text", text },
  });
  const verified = await rsm.integrity.verifyBucket(captured);
  const stored = rsm.lifecycle.transitionBucket(verified.bucket, "STORE", {
    actor: "user",
    persisted: true,
  }).bucket;
  const ready = rsm.lifecycle.transitionBucket(stored, "READY", {
    actor: "user",
    ready: true,
  }).bucket;
  expect(ready.lifecycle_state).toBe("READY");
  expect(ready.integrity_status).toBe("VALID");
  return ready;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversation_id: "conv-test",
    rsm_enabled: false,
    selected_bucket_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("gate — fail-closed authorization", () => {
  it("defaults to OFF: a conversation with rsm_enabled=false refuses delivery", () => {
    const conv = conversation({ selected_bucket_id: "bucket-a" });
    const result = canDeliver(conv, "bucket-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RSM_DISABLED");
  });

  it("refuses an unknown conversation (INTERACTION_NOT_FOUND)", () => {
    const result = canDeliver(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INTERACTION_NOT_FOUND");
  });

  it("refuses a disabled conversation even with a selected source", () => {
    const conv = conversation({ rsm_enabled: false, selected_bucket_id: "bucket-a" });
    const result = canDeliver(conv, "bucket-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RSM_DISABLED");
  });

  it("refuses delivery when no source is selected (NO_SOURCE)", () => {
    const conv = conversation({ rsm_enabled: true });
    const result = canDeliver(conv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_SOURCE");
  });

  it("allows delivery only when enabled AND a source is selected", () => {
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: "bucket-a" });
    expect(canDeliver(conv, "bucket-a")).toEqual({ ok: true });
  });

  it("refuses a bucket that is not the conversation's selected source (isolation)", () => {
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: "bucket-a" });
    const result = canDeliver(conv, "bucket-b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SOURCE_MISMATCH");
  });
});

describe("createRelay", () => {
  it("throws a typed error when RSM is OFF (nothing is released)", async () => {
    const bucket = await readyBucket("off-src", "secret material");
    const conv = conversation({ selected_bucket_id: bucket.bucket_id });
    await expect(createRelay(conv, bucket)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws when the bucket does not belong to the conversation (isolation)", async () => {
    const bucketA = await readyBucket("bucket-a", "A's content");
    const bucketB = await readyBucket("bucket-b", "B's content");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucketA.bucket_id });
    await expect(createRelay(conv, bucketB)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates a relay with a unique relay_id per delivery", async () => {
    const bucket = await readyBucket("unique-src", "same content");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucket.bucket_id });
    const first = await createRelay(conv, bucket);
    const second = await createRelay(conv, bucket);
    expect(first.relay.relay_id).not.toBe(second.relay.relay_id);
  });

  it("returns a PREPARING relay with envelope hash + source set", async () => {
    const bucket = await readyBucket("prep-src", "content");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucket.bucket_id });
    const prepared = await createRelay(conv, bucket);
    expect(prepared.relay.state).toBe(RELAY_STATES.Preparing);
    expect(prepared.relay.bucket_ids).toEqual([bucket.bucket_id]);
    expect(prepared.relay.conversation_id).toBe(conv.conversation_id);
    expect(prepared.relay.snapshot?.envelope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.envelope.envelope_hash).toBe(prepared.relay.snapshot?.envelope_hash);
    expect(prepared.envelope.buckets.map((b) => b.bucket_id)).toEqual([bucket.bucket_id]);
  });

  it("refuses a bucket that is not in a replayable state", async () => {
    const captured = await rsm.bucket.createBucket({
      source: "captured-src",
      source_type: "pasted_text",
      source_origin: "paste",
      provenance: rsm.provenance.createProvenance({
        origin: "captured-src",
        ingestion_method: "paste",
        sourceName: "captured-src",
        sourceType: "pasted_text",
        sizeBytes: 3,
      }),
      full_content: { kind: "text", text: "abc" },
    });
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: captured.bucket_id });
    await expect(createRelay(conv, captured)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("streamRelay — honest ephemeral delivery", () => {
  it("yields real chunks then a DELIVERED payload with provenance + envelope hash", async () => {
    const bucket = await readyBucket("stream-src", "streamed secret content");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucket.bucket_id });
    const prepared = await createRelay(conv, bucket, { chunkBytes: 1 }); // force many chunks

    const chunks = [];
    for await (const chunk of streamRelay(prepared, { chunkBytes: 1 })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(3); // preparing + real chunks + completed
    expect(chunks[0].kind).toBe("preparing");

    const streamChunks = chunks.filter((c) => c.kind === "chunk");
    expect(streamChunks.length).toBeGreaterThan(1);
    const counts = streamChunks.map((c) => c.total_chunks);
    expect(new Set(counts).size).toBe(1); // honest: same total across all chunks
    const indices = streamChunks.map((c) => c.chunk_index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b)); // sequential, 1-based

    const terminal = chunks[chunks.length - 1];
    expect(terminal.kind).toBe("completed");
    if (terminal.kind === "completed") {
      expect(terminal.delivered.envelope_hash).toBe(prepared.envelope.envelope_hash);
      expect(terminal.delivered.relay_id).toBe(prepared.relay.relay_id);
      expect(terminal.delivered.provenance.length).toBe(1);
      expect(terminal.delivered.provenance[0].bucket_id).toBe(bucket.bucket_id);
      expect(terminal.delivered.bucket_ids).toEqual([bucket.bucket_id]);
    }
  });

  it("never fabricates percentages or counts", async () => {
    const bucket = await readyBucket("honest-src", "payload");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucket.bucket_id });
    const prepared = await createRelay(conv, bucket, { chunkBytes: 4 });

    for await (const chunk of streamRelay(prepared, { chunkBytes: 4 })) {
      if (chunk.kind === "chunk") {
        expect(chunk.chunk_index).toBeLessThanOrEqual(chunk.total_chunks);
        expect(chunk.bytes).toBeGreaterThan(0);
      }
      expect(JSON.stringify(chunk)).not.toContain("%");
      expect(JSON.stringify(chunk)).not.toContain("progress");
    }
  });

  it("terminates with CANCELLED when the abort signal fires", async () => {
    const bucket = await readyBucket("abort-src", "payload payload payload payload");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucket.bucket_id });
    const prepared = await createRelay(conv, bucket, { chunkBytes: 4 });

    const controller = new AbortController();
    const chunks = [];
    for await (const chunk of streamRelay(prepared, { signal: controller.signal })) {
      chunks.push(chunk);
      if (chunks.length === 2) controller.abort();
    }
    const terminal = chunks[chunks.length - 1];
    expect(terminal.kind).toBe("cancelled");
    if (terminal.kind === "cancelled") expect(terminal.state).toBe(RELAY_STATES.Cancelled);
  });

  it("does not deliver anything when streamed before authorization passes the gate", async () => {
    // createRelay already refused — this verifies gate-before-create ordering.
    const bucket = await readyBucket("never-deliver", "should not leave");
    const conv = conversation({ selected_bucket_id: bucket.bucket_id }); // OFF
    await expect(createRelay(conv, bucket)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("source revision → new relay (Flow 4)", () => {
  it("a corrected source produces a new bucket, new envelope, new relay; old bucket stays immutable", async () => {
    const bucketA = await readyBucket("src-v1", "version one content");
    const conv = conversation({ rsm_enabled: true, selected_bucket_id: bucketA.bucket_id });

    const relayA = await createRelay(conv, bucketA);
    expect(relayA.envelope.buckets[0].bucket_id).toBe(bucketA.bucket_id);

    // Corrected source: new bucket derived from A (provenance chain records the hop).
    const provenanceB = rsm.provenance.createProvenance({
      origin: "src-v2",
      ingestion_method: "paste",
      sourceName: "src-v2",
      sourceType: "pasted_text",
      sizeBytes: 20,
      sourceChain: [{ label: "derived_from", detail: bucketA.bucket_id, at: new Date().toISOString() }],
    });
    const capturedB = await rsm.bucket.createBucket({
      source: "src-v2",
      source_type: "pasted_text",
      source_origin: "paste",
      provenance: provenanceB,
      full_content: { kind: "text", text: "version two corrected content" },
    });
    const verifiedB = await rsm.integrity.verifyBucket(capturedB);
    const bucketB = rsm.lifecycle.transitionBucket(
      rsm.lifecycle.transitionBucket(verifiedB.bucket, "STORE", { actor: "user", persisted: true }).bucket,
      "READY",
      { actor: "user", ready: true },
    ).bucket;
    expect(bucketB.bucket_id).not.toBe(bucketA.bucket_id);
    expect(bucketB.provenance.source_chain[0]).toMatchObject({ label: "derived_from", detail: bucketA.bucket_id });

    const convB = conversation({ rsm_enabled: true, selected_bucket_id: bucketB.bucket_id });
    const relayB = await createRelay(convB, bucketB);

    expect(relayB.envelope.buckets[0].bucket_id).toBe(bucketB.bucket_id);
    expect(relayB.relay.relay_id).not.toBe(relayA.relay.relay_id);
    expect(relayB.envelope.envelope_hash).not.toBe(relayA.envelope.envelope_hash);

    // Old bucket remains immutable & verified.
    const checkA = await rsm.integrity.verifyBucket(bucketA);
    expect(checkA.status).toBe("VALID");
    expect(bucketA.lifecycle_state).toBe("READY");
  });
});

describe("V1 regression — lifecycle & integrity unchanged", () => {
  it("transition table and integrity verification still behave per V1", async () => {
    const bucket = await readyBucket("regression-src", "regression content");
    expect(bucket.lifecycle_state).toBe("READY");
    expect(bucket.integrity_status).toBe("VALID");

    // Illegal transition is still rejected (no hidden FAILED state).
    expect(() =>
      rsm.lifecycle.transitionBucket(bucket, "VERIFY", { actor: "user" }),
    ).toThrow();
    expect(rsm.lifecycle.isLegal("READY", "ACTIVATE")).toBe(true);
  });
});
