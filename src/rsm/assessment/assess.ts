/**
 * SOURCE ASSESSMENT — deterministic rule-based triage.
 *
 * This module answers the NARROW question: "Does this request materially
 * require observation of external source material?" It uses a small set of
 * deterministic signals — no model, no ML, no intent classifier. The result
 * tells the host whether to engage RSM or let the Agent proceed directly.
 *
 * See types.ts for signal definitions and the verdict model.
 *
 * Pure TypeScript. Zero React/Vite/Supabase/AI imports.
 */

import {
  ASSESSMENT_VERDICTS,
  type AssessmentSignal,
  type RequestAssessment,
  type RequestAssessmentInput,
} from "./types";

/* ──────────────────────────────────────────────────────────────── */
/*  Signal detectors (deterministic, no LLM)                         */
/* ──────────────────────────────────────────────────────────────── */

/** Noun-based source-type hints — the request mentions a concrete type of external material. */
const SOURCE_HINT_PATTERNS: RegExp[] = [
  /\bpdf\b/i,
  /\b(file|files)\b/i,
  /\b(document|documents)\b/i,
  /\b(folder|folders|directory)\b/i,
  /\b(attachment|attachments)\b/i,
  /\b(screenshot|screenshots?)\b/i,
  /\b(image|images)\b/i,
  /\b(photo|photos|picture|pictures)\b/i,
  /\b(markdown|notes)\b/i,
  /\b(conversation[s]? export|chatgpt export)\b/i,
  /\bpasted?\s*text\b/i,
  /\b(source|sources|material)\b/,
];

/** Verbs that signal the request wants to read/inspect/transform external material. */
const OBSERVATION_VERB_PATTERNS: RegExp[] = [
  /\bsummar(ize|ise)\b/i,
  /\b(compare|contrast)\b/i,
  /\banaly(ze|se)\b/i,
  /\bextract\b/i,
  /\btranscribe\b/i,
  /\breview\b/i,
  /\bparaphrase\b/i,
  /\boutline\b/i,
  /\bbreak\s*down\b/i,
  /\b(detect|identify)\s*(?:the\s+)?(?:key|main|primary)\s+(?:points|ideas|themes)\b/i,
  /\bkey\s*points\b/i,
  /\bmain\s*idea\b/i,
  /\btl;dr\b/i,
  /\bparse\b/i,
  /\bocr\b/i,
  /\binspect\b/i,
  /\bcondense\b/i,
  /\btranslate\b/i,
  /\bdescribe\s+(?:the\s+)?(?:file|document|image|screenshot|attachment|content)\b/i,
  /\bread\s+(?:this|that|the|a)\s+(?:file|document|pdf|image|screenshot|attachment)\b/i,
  /\bexplain\s+(?:this|the)\s+(?:file|document|pdf|image|screenshot|attachment)\b/i,
  /\bwhat\s+(?:does|is)\s+(?:this|the|that)\s+(?:file|document|pdf|image|screenshot|attachment)\b/i,
  /\bwhat['']s\s+in\s+(?:this|the|that)\b/i,
  /\bcompare\s+(?:these|those)\b/i,
  /\blist\s+(?:the|all)\s+(?:key|main)\s+(?:points|ideas|facts|themes|topics)\b/i,
  /\bwhat['']s\s+(?:in|inside)\s+(?:this|that|the)\b/i,
];

/** Demonstrative/possessive patterns that directly point at available material. */
const DIRECT_REFERENCE_PATTERNS: RegExp[] = [
  /\b(this|that|these|those)\s+(file|document|pdf|image|screenshot|attachment|folder|export|note|notes|text|content|source|material)\b/i,
  /\b(the|that)\s+(attached|uploaded|pasted|selected|above)\b/i,
  /\b(attached|uploaded|pasted|selected)\s+(file|document|pdf|image|screenshot|attachment|content|text)\b/i,
  /\bin\s+(this|that|these|those)\b/i,
];

/* ──────────────────────────────────────────────────────────────── */
/*  Public API                                                        */
/* ──────────────────────────────────────────────────────────────── */

/**
 * Assess whether a request materially requires external source observation.
 *
 * @returns A `RequestAssessment` with a clear verdict and the signals that
 *          produced it. The host application uses the verdict to decide
 *          whether to feed the request through RSM (SOURCE_REQUIRED) or
 *          pass it directly to the Agent (NO_SOURCE_REQUIRED).
 *
 * Example:
 *   assessRequest({ request: "What is 2 + 2?" })
 *   // → { verdict: "NO_SOURCE_REQUIRED", reason: "…", signals: [] }
 *
 *   assessRequest({ request: "Summarize this PDF" })
 *   // → { verdict: "SOURCE_REQUIRED", reason: "…", signals: ["SOURCE_TYPE_HINT", "OBSERVATION_VERB"] }
 */
export function assessRequest(input: RequestAssessmentInput): RequestAssessment {
  const signals: AssessmentSignal[] = [];

  // ── Detect signals ──────────────────────────────────────────────
  const hasAttached = (input.available_sources?.length ?? 0) > 0 || !!input.selected_source;
  if (hasAttached) signals.push("MATERIAL_AVAILABLE");

  const hasSourceHint = SOURCE_HINT_PATTERNS.some((re) => re.test(input.request));
  if (hasSourceHint) signals.push("SOURCE_TYPE_HINT");

  const hasVerb = OBSERVATION_VERB_PATTERNS.some((re) => re.test(input.request));
  if (hasVerb) signals.push("OBSERVATION_VERB");

  const hasDirectRef = DIRECT_REFERENCE_PATTERNS.some((re) => re.test(input.request));
  if (hasDirectRef) signals.push("DIRECT_REFERENCE");

  if (input.explicit_no_material) signals.push("EXPLICIT_NO_MATERIAL");

  // ── Decision ────────────────────────────────────────────────────
  //
  //   SOURCE_REQUIRED when there is a believable reason to think the
  //   request depends on source material:
  //
  //     a) Material is available AND the request shows interest in it
  //        (verb, direct reference, or source-type hint).
  //     b) No material is available but the request strongly references
  //        it: verb + source-type hint (e.g. "Summarize this PDF" —
  //        no PDF loaded yet, but RSM-first prep is expected).
  //     c) Direct reference alone (rare — only when pointing at something
  //        the app should locate).
  //
  //   NO_SOURCE_REQUIRED in all other cases. The Agent may proceed.
  //   An explicit `explicit_no_material` flag always forces NO_SOURCE.
  //
  const sourceRequired =
    !input.explicit_no_material &&
    (hasAttached
      ? hasVerb || hasDirectRef || hasSourceHint
      : (hasVerb && hasSourceHint) || hasDirectRef);

  if (sourceRequired) {
    const parts: string[] = [];
    if (hasAttached) parts.push("source material is available");
    if (hasSourceHint) parts.push("the request names a source type");
    if (hasVerb) parts.push("the request asks to inspect or transform material");
    if (hasDirectRef) parts.push("the request points directly at material");
    return {
      verdict: ASSESSMENT_VERDICTS.SourceRequired,
      reason: parts.join("; ") || "Source assessment signals matched.",
      signals,
    };
  }

  const whyNot: string = input.explicit_no_material
    ? "The request explicitly states no material is needed."
    : !hasSourceHint && !hasVerb && !hasDirectRef
      ? "No source-type hints, observation verbs, or direct references detected."
      : hasAttached && !hasVerb && !hasDirectRef
        ? "Material is present but the request does not inspect or reference it."
        : "The request does not materially depend on external source material.";
  return { verdict: ASSESSMENT_VERDICTS.NoSourceRequired, reason: whyNot, signals };
}