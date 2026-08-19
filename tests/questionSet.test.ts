import { describe, it, expect } from "vitest";
import {
  validateQuestionSet,
  withDerivedTiers,
  toStored,
  nextQuestionId,
  factoryQuestionSet,
  MAX_LEVELS,
  type StoredQuestion,
} from "@/lib/questionSet";
import { QUESTIONS } from "@/lib/questions";

// One module gates every path into the stored question set: the draft
// save, the publish, and the runtime read. A set that fails here must
// never reach a prospect, and a set that passes here must be safe to
// score without further checking.

function question(
  id: string,
  gap: StoredQuestion["gap"],
  choiceCount = 5
): StoredQuestion {
  return {
    id,
    gap,
    statement: `${id} statement`,
    levels: Array.from({ length: choiceCount }, (_, i) => ({
      value: i + 1,
      label: `${id} label ${i + 1}`,
      description: `${id} description ${i + 1}`,
    })),
  };
}

// The smallest set that satisfies "every gap has at least one question".
function validSet(): StoredQuestion[] {
  return [
    question("W1", "wealth"),
    question("A1", "accounting"),
    question("V1", "value"),
    question("E1", "earnings"),
  ];
}

describe("validateQuestionSet accepts", () => {
  it("a minimal set with one question per gap", () => {
    const result = validateQuestionSet(validSet());
    expect(result.ok).toBe(true);
  });

  it("the factory question set", () => {
    // If the shipped defaults cannot pass their own validator, the
    // fallback path is broken and every other guarantee is worthless.
    const result = validateQuestionSet(factoryQuestionSet());
    expect(result.ok).toBe(true);
  });

  it("mixed choice counts across questions", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 3);
    set[1] = question("A1", "accounting", 7);
    expect(validateQuestionSet(set).ok).toBe(true);
  });

  it("a two-choice question, which is allowed but discouraged", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 2);
    expect(validateQuestionSet(set).ok).toBe(true);
  });

  it("trims surrounding whitespace from text", () => {
    const set = validSet();
    set[0].statement = "  padded  ";
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.questions[0].statement).toBe("padded");
  });
});

describe("validateQuestionSet rejects", () => {
  it("a value that is not an array", () => {
    expect(validateQuestionSet({ nope: true }).ok).toBe(false);
  });

  it("a gap with no questions", () => {
    const set = validSet().filter((q) => q.gap !== "wealth");
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/wealth/i);
  });

  it("duplicate question ids", () => {
    const set = [...validSet(), question("W1", "wealth")];
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/W1/);
  });

  it("an id with characters that would break an Excel header or JSON key", () => {
    const set = validSet();
    set[0].id = "W 1!";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("fewer than two choices", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", 1);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("more than the maximum choices", () => {
    const set = validSet();
    set[0] = question("W1", "wealth", MAX_LEVELS + 1);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("level values that are not contiguous from 1", () => {
    const set = validSet();
    set[0].levels = [
      { value: 1, label: "a", description: "a" },
      { value: 3, label: "b", description: "b" },
    ];
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an empty statement", () => {
    const set = validSet();
    set[0].statement = "   ";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an empty choice label", () => {
    const set = validSet();
    set[0].levels[2].label = "";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an unknown gap", () => {
    const set = validSet();
    (set[0] as { gap: string }).gap = "marketing";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("a statement past the length cap", () => {
    const set = validSet();
    set[0].statement = "x".repeat(401);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("reports every problem at once rather than only the first", () => {
    const set = validSet();
    set[0].statement = "";
    set[1].statement = "";
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate the input it was given", () => {
    const set = validSet();
    const before = JSON.parse(JSON.stringify(set));
    validateQuestionSet(set);
    expect(set).toEqual(before);
  });

  // --- Fix round 1 coverage (findings 1-4): these paths already existed
  // and were already correct, but nothing pinned them in place.

  it("a level value that is NaN", () => {
    const set = validSet();
    set[0].levels[0] = { value: NaN, label: "a", description: "a" };
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("a level value that is Infinity", () => {
    const set = validSet();
    set[0].levels[0] = { value: Infinity, label: "a", description: "a" };
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("more than MAX_QUESTIONS questions", () => {
    const set = Array.from({ length: 101 }, (_, i) =>
      question(`Q${i + 1}`, i % 2 === 0 ? "wealth" : "accounting")
    );
    // Cover the other two gaps too, so the only failure is the count cap.
    set.push(question("V1", "value"), question("E1", "earnings"));
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/100/);
    }
  });

  it("a choice label past the length cap", () => {
    const set = validSet();
    set[0].levels[0].label = "x".repeat(81);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("a choice description past the length cap", () => {
    const set = validSet();
    set[0].levels[0].description = "x".repeat(601);
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("an empty choice description", () => {
    const set = validSet();
    set[0].levels[0].description = "";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("levels that is not an array", () => {
    const set = validSet();
    (set[0] as { levels: unknown }).levels = "not an array";
    expect(validateQuestionSet(set).ok).toBe(false);
  });

  it("reports a duplicate id even when the duplicate also has an invalid gap", () => {
    // Finding 3: an invalid-gap question used to be dropped before the
    // duplicate-id pass ran, so this duplicate went unreported until the
    // gap was fixed and the set re-submitted.
    const set = validSet();
    const dupe = question("W1", "wealth");
    (dupe as { gap: string }).gap = "marketing";
    set.push(dupe);
    const result = validateQuestionSet(set);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/duplicate.*W1/i);
    }
  });

  it("a circular input returns ok:false instead of throwing", () => {
    // Finding 1: validateQuestionSet used to deep-copy via
    // JSON.stringify, which throws on a circular structure. The function's
    // signature promises unknown -> ValidateResult, never a throw.
    const set = validSet();
    (set[0] as unknown as Record<string, unknown>).self = set[0];
    expect(() => validateQuestionSet(set)).not.toThrow();
    expect(validateQuestionSet(set).ok).toBe(true);
  });
});

describe("withDerivedTiers", () => {
  it("attaches a tier to every level", () => {
    // Tiers distribute evenly by position now, not fixed 25/50/75 cutoffs
    // on the normalized score -- those collided at five choices (see
    // lib/scoring.ts's tierForLevel), putting the extra level at the
    // bottom instead of duplicating "Excellent" at the top.
    const [q] = withDerivedTiers([question("W1", "wealth", 5)]);
    expect(q.levels.map((l) => l.tier)).toEqual([
      "Poor",
      "Poor",
      "Fair",
      "Good",
      "Excellent",
    ]);
  });

  it("derives tiers correctly for a three-choice question", () => {
    const [q] = withDerivedTiers([question("W1", "wealth", 3)]);
    expect(q.levels.map((l) => l.tier)).toEqual(["Poor", "Fair", "Good"]);
  });
});

describe("toStored", () => {
  it("drops the tier, which is derived rather than stored", () => {
    const stored = toStored(QUESTIONS);
    expect(stored[0].levels[0]).not.toHaveProperty("tier");
  });

  it("round-trips the factory set through validation", () => {
    expect(validateQuestionSet(toStored(QUESTIONS)).ok).toBe(true);
  });
});

describe("nextQuestionId", () => {
  it("uses the gap's letter and the next free number", () => {
    expect(nextQuestionId(validSet(), "wealth")).toBe("W2");
  });

  it("does not reuse an id that already exists in another gap", () => {
    const set = [...validSet(), question("W2", "value")];
    expect(nextQuestionId(set, "wealth")).toBe("W3");
  });

  it("gives each gap its own letter", () => {
    expect(nextQuestionId(validSet(), "accounting")).toBe("A2");
    expect(nextQuestionId(validSet(), "value")).toBe("V2");
    expect(nextQuestionId(validSet(), "earnings")).toBe("E2");
  });
});
