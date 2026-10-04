/**
 * Delivery authorization gate — fail-closed, lives in the domain.
 *
 * This is the ONLY place that decides whether RSM context may be released.
 * It is a pure function over the conversation (and, optionally, the bucket the
 * caller intends to deliver), so the UI cannot circumvent it: the store hook
 * and every delivery path call `canDeliver` before anything is released.
 *
 * Rule: RSM OFF (or unknown conversation, or no source) ⇒ NO context released.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import type { Conversation } from "./types";

/** Typed refusal reasons (repo error-code conventions). */
export type GateCode =
  | "RSM_DISABLED"
  | "INTERACTION_NOT_FOUND"
  | "NO_SOURCE"
  | "SOURCE_MISMATCH";

export type GateResult =
  | { ok: true }
  | { ok: false; code: GateCode; message: string };

/**
 * Decide whether a delivery is authorized.
 *
 * @param conversation the consuming session (null/undefined = unknown).
 * @param bucketId     the bucket the caller intends to deliver. When provided,
 *                     it MUST equal the conversation's `selected_bucket_id`
 *                     (cross-conversation delivery is refused — isolation).
 */
export function canDeliver(
  conversation: Conversation | null | undefined,
  bucketId?: string,
): GateResult {
  if (!conversation) {
    return {
      ok: false,
      code: "INTERACTION_NOT_FOUND",
      message: "No conversation exists for this session yet.",
    };
  }
  if (conversation.rsm_enabled !== true) {
    return {
      ok: false,
      code: "RSM_DISABLED",
      message: "RSM is OFF for this conversation — no context was released.",
    };
  }
  if (!conversation.selected_bucket_id) {
    return {
      ok: false,
      code: "NO_SOURCE",
      message: "No source bucket is selected for this conversation.",
    };
  }
  if (bucketId !== undefined && bucketId !== conversation.selected_bucket_id) {
    return {
      ok: false,
      code: "SOURCE_MISMATCH",
      message: "That source does not belong to this conversation.",
    };
  }
  return { ok: true };
}
