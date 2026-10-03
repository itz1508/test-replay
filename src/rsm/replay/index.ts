/**
 * Replay module — READ-ONLY context envelopes for LLM consumption.
 *
 * Pure TypeScript. Builds the `context_domains` envelope from eligible buckets
 * (READY / RELEASED by default). Replay never mutates buckets or events.
 */
export * from "./envelope";