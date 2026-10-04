/**
 * Unit tests — SOURCE ASSESSMENT.
 *
 * Covers the two architectural paths required by the refactor spec:
 *   1. Direct Agent path — ordinary requests return NO_SOURCE_REQUIRED and
 *      RSM is not engaged.
 *   2. Source-first path — requests that materially depend on external
 *      material return SOURCE_REQUIRED so the host runs RSM first.
 * Plus the deterministic-signal transparency and the explicit
 * "no material needed" override.
 */
import { describe, expect, it } from "vitest";
import { assessRequest } from "./assess";
import { ASSESSMENT_VERDICTS } from "./types";

describe("SOURCE ASSESSMENT — direct Agent path (NO_SOURCE_REQUIRED)", () => {
  it("ordinary non-source requests proceed directly to the Agent", () => {
    const r = assessRequest({ request: "What is 2 + 2?" });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.NoSourceRequired);
    expect(r.signals).toEqual([]);
  });

  it("conversation-continuation requests do not force RSM", () => {
    const r = assessRequest({ request: "Continue our conversation." });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.NoSourceRequired);
  });

  it("generic requests with attached material but no inspection intent stay direct", () => {
    const r = assessRequest({
      request: "Let's keep going.",
      available_sources: ["bucket-1"],
    });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.NoSourceRequired);
  });

  it("an explicit no-material override always yields NO_SOURCE_REQUIRED", () => {
    const r = assessRequest({
      request: "Summarize this PDF",
      explicit_no_material: true,
    });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.NoSourceRequired);
    expect(r.signals).toContain("EXPLICIT_NO_MATERIAL");
  });
});

describe("assessRequest — Source-first path (SOURCE_REQUIRED)", () => {
  it("a request to summarize a PDF requires source observation", () => {
    const r = assessRequest({ request: "Summarize this PDF" });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.SourceRequired);
    expect(r.signals).toContain("SOURCE_TYPE_HINT");
    expect(r.signals).toContain("OBSERVATION_VERB");
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("comparing screenshots requires source observation", () => {
    const r = assessRequest({ request: "Compare these two screenshots." });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.SourceRequired);
  });

  it("attached material + inspection intent engage RSM", () => {
    const r = assessRequest({
      request: "What are the key points of this document?",
      available_sources: ["bucket-7"],
    });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.SourceRequired);
    expect(r.signals).toContain("MATERIAL_AVAILABLE");
    expect(r.signals).toContain("DIRECT_REFERENCE");
  });

  it("a selected source with a direct reference to it engages", () => {
    const r = assessRequest({
      request: "Explain this screenshot.",
      selected_source: "bucket-9",
    });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.SourceRequired);
    expect(r.signals).toContain("MATERIAL_AVAILABLE");
  });
});

describe("assess — transparency and boundary", () => {
  it("always returns a human reason, never raw internals", () => {
    for (const r of [assessRequest({ request: "hello" }), assessRequest({ request: "Summarize this PDF" })]) {
      expect(typeof r.reason).toBe("string");
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.signals).toBeInstanceOf(Array);
    }
  });

  it("noun-only mentions without intent are not force-required (no scope creep)", () => {
    // "PDF" appears, but no action — Agent may proceed; nothing was asked.
    const r = assessRequest({ request: "PDF files are great for sharing." });
    expect(r.verdict).toBe(ASSESSMENT_VERDICTS.NoSourceRequired);
  });
});