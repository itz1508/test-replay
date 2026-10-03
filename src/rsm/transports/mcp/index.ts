/**
 * MCP transport — BOUNDARY SPEC ONLY.
 *
 * Defines the Model Context Protocol tool/resource surface the future Python
 * daemon exposes so LLM clients can list, read, replay, and export RSM
 * context. No implementation code here — the daemon implements these
 * contracts.
 *
 * Tool naming: `rsm_*` tools for actions, `rsm://` resource template for
 * static context reads.
 */

import type { Bucket } from "../../bucket/types";
import type { ReplayEnvelope } from "../../replay/index";

/** MCP tool input shape (tool definitions follow MCP's JSON schema style). */
export interface McpToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for `input` — minimal inline spec here, expanded by daemon. */
  inputSchema: Record<string, unknown>;
}

/** Static resources readable via the MCP resource protocol. */
export interface McpResourceTemplate {
  uriTemplate: string; // e.g. "rsm://buckets/{bucket_id}"
  name: string;
  description: string;
  mimeType: "application/json";
}

/** Concrete result payloads the daemon returns through MCP. */
export interface McpListBucketsResult {
  buckets: Bucket[]; // newest first; supports cursor pagination later
}

export interface McpReplayResult {
  envelope: ReplayEnvelope;
}

export const RSM_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "rsm_list_buckets",
    description: "List captured context buckets, newest first.",
    inputSchema: { type: "object", properties: { state: { type: "string", enum: [] } } },
  },
  {
    name: "rsm_get_bucket",
    description: "Read a single bucket with its append-only event log.",
    inputSchema: { type: "object", properties: { bucket_id: { type: "string" } }, required: ["bucket_id"] },
  },
  {
    name: "rsm_transition",
    description: "Advance a bucket's lifecycle (VERIFY, STORE, READY, ACTIVATE, RELEASE, CLOSE).",
    inputSchema: {
      type: "object",
      properties: { bucket_id: { type: "string" }, action: { type: "string" }, reason: { type: "string" } },
      required: ["bucket_id", "action"],
    },
  },
  {
    name: "rsm_create_replay",
    description: "Build a READ/RELEASE replay envelope for the conversation context.",
    inputSchema: { type: "object", properties: {} },
  },
];

export const RSM_MCP_RESOURCES: ReadonlyArray<McpResourceTemplate> = [
  {
    uriTemplate: "rsm://buckets/{bucket_id}",
    name: "Bucket",
    description: "Canonical bucket JSON (hash, provenance, lifecycle, content).",
    mimeType: "application/json",
  },
];

/** MCP tool result union the daemon must satisfy. */
export type RsmMcpResult = McpListBucketsResult | McpReplayResult | { bucket: Bucket } | { envelope: ReplayEnvelope };