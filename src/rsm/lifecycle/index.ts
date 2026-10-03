/**
 * RSM lifecycle module — canonical state machine + append-only event log.
 *
 * Pure TypeScript (zero React/Vite/Supabase/AI). The state machine validates
 * transitions and preconditions and returns events; persistence of buckets and
 * events is the repository layer's responsibility (see the persistence task).
 */
export * from "./types";
export * from "./state-machine";