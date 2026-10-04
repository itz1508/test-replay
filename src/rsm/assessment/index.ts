/**
 * SOURCE ASSESSMENT module — narrow, deterministic request triage.
 *
 * Answers ONLY: "Does this request materially require observation of external
 * source material?" The verdict drives the host's RSM-first decision:
 *
 *   NO_SOURCE_REQUIRED  → Agent may proceed directly.
 *   SOURCE_REQUIRED     → RSM-first: observe → prepare → validate → release.
 *
 * It never authorizes release — that stays with the fail-closed relay gate.
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */
export * from "./types";
export * from "./assess";