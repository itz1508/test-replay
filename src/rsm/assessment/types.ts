/**
 * SOURCE ASSESSMENT — narrow request triage contract.
 *
 * Source Assessment answers ONE architectural question, nothing more:
 *   "Does this request materially require observation of external source
 *    material?"
 *
 * It is NOT a general-purpose intent classifier and NOT an Agent. It is a
 * deterministic, signal-based predicate over the request text and the
 * material that is available to observe. The host application (which owns
 * the Agent/completion boundary) uses the verdict to choose between:
 *
 *   NO_SOURCE_REQUIRED  → Agent may proceed directly (no RSM involvement).
 *   SOURCE_REQUIRED     → RSM-first: observe → prepare → release, then Agent.
 *
 * RSM does NOT decide whether to RELEASE — that remains the fail-closed
 * domain gate (src/rsm/relay/gate.ts). Assessment only decides whether the
 * message materially depends on external source material; release authority
 * stays with the conversation gate. This boundary is deliberately thin.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

/** The only two legal verdicts (do not broaden — §4 of the refactor spec). */
export const ASSESSMENT_VERDICTS = {
  SourceRequired: "SOURCE_REQUIRED",
  NoSourceRequired: "NO_SOURCE_REQUIRED",
} as const;
export type AssessmentVerdict = (typeof ASSESSMENT_VERDICTS)[keyof typeof ASSESSMENT_VERDICTS];

/**
 * Which deterministic signal(s) fired. Used for transparency and for the
 * control surface to show why RSM was (or was not) engaged — never to make
 * the Agent's decisions.
 */
export type AssessmentSignal =
  /** Request names a source type: pdf, document, screenshot, image, attachment… */
  | "SOURCE_TYPE_HINT"
  /** Request asks for observation-style work: summarize, compare, extract… */
  | "OBSERVATION_VERB"
  /** Source material is available for observation (attached / selected). */
  | "MATERIAL_AVAILABLE"
  /** Request points directly at the material: "this file", "the attached…". */
  | "DIRECT_REFERENCE"
  /** Explicit override — the request itself says no material is needed. */
  | "EXPLICIT_NO_MATERIAL";

/** Input to the assessment. All fields optional except `request`. */
export interface RequestAssessmentInput {
  /** The user/Agent-facing request text to triage. */
  request: string;
  /** Known source material (source names / bucket ids) available right now. */
  available_sources?: string[];
  /** The conversation's selected source, when one is set. */
  selected_source?: string | null;
  /** Set when the request explicitly declares no material is needed. */
  explicit_no_material?: boolean;
}

/** Transparent, deterministic assessment result. */
export interface RequestAssessment {
  verdict: AssessmentVerdict;
  /** The precise reason for the verdict (human, UI-safe). */
  reason: string;
  /** Every signal that fired — shows WHY, never decides WHY-NOT. */
  signals: AssessmentSignal[];
}