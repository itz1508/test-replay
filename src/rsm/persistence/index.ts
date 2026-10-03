/**
 * RSM persistence boundary — barrel module.
 *
 * Re-exports the repository interface and the IndexedDB implementation.
 * Domain leaf modules (bucket, lifecycle, integrity, extraction) must
 * depend only on the interface from types.ts — never on the implementation.
 */

export * from "./types";
export * from "./indexeddb";