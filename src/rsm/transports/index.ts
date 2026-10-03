/**
 * Transport boundaries — exports and future daemon contracts.
 *
 * - json-export: canonical JSON export (pure functions).
 * - stdout: console/serial debugging output.
 * - http: contract for the future Python HTTP daemon (spec only).
 * - mcp: contract for the future MCP server (spec only).
 *
 * Pure TypeScript, no React/Vite/Supabase/AI imports.
 */
export * from "./json-export";
export * from "./stdout";
export * as http from "./http";
export * as mcp from "./mcp";