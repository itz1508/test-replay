/**
 * RSM domain root.
 *
 * Everything under src/rsm/ is pure TypeScript with ZERO imports from React,
 * Vite, browser UI, Supabase, or AI/LLM libraries. React/Vite (the execution
 * shell) imports from this root — never the reverse.
 */
export * from "./errors";
export * from "./crypto/hash";
export * as bucket from "./bucket";
export * as provenance from "./provenance";
export * as integrity from "./integrity";
export * as lifecycle from "./lifecycle";
export * as persistence from "./persistence";
export * as extraction from "./extraction";
export * as replay from "./replay";
export * as transports from "./transports";