import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  tierForLevel,
  scoreAssessment,
} from "@/lib/scoring";
import type { Question } from "@/lib/questions";

// The choice count is no longer fixed at five, so the scoring formula's
// denominator can no longer be the constant 4. These tests pin the
// generalization AND its backward compatibility: for a five-choice
// question every number below must be identical to what the old
// formula produced, which is what lets tests/scoring.test.ts stay
// untouched as the regression gate.

function q(id: string, gap: Question["gap"], choiceCount: number): Question {
  return {
    id,
    gap,
    statement: `${id} statement`,
    levels: Array.from({ length: choiceCount }, (_, i) => ({
      value: i + 1,
      tier: tierForLevel(i + 1, choiceCount),
      label: `${id} label ${i + 1}`,
      description: `${id} description ${i + 1}`,
    })),
  };
}

// One question per gap so a set is valid; gaps are fixed at four.
function minimalSet(choiceCount: number): Question[] {
  return [
    q("W1", "wealth", choiceCount),
    q("A1", "accounting", choiceCount),
    q("V1", "value", choiceCount),
    q("E1", "earnings", choiceCount),
  ];
}

describe("normalizeAnswer with a variable choice count", () => {
  it("defaults to five choices when the count is omitted", () => {
    // tests/scoring.test.ts depends on this single-argument form.
    expect(normalizeAnswer(3)).toBe(50);
  });

  it("maps the lowest choice to 0 at any count", () => {
    expect(normalizeAnswer(1, 2)).toBe(0);
    expect(normalizeAnswer(1, 3)).toBe(0);
    expect(normalizeAnswer(1, 7)).toBe(0);
  });

  it("maps the highest choice to 100 at any count", () => {
    expect(normalizeAnswer(2, 2)).toBe(100);
    expect(normalizeAnswer(3, 3)).toBe(100);
    expect(normalizeAnswer(7, 7)).toBe(100);
  });

  it("spaces three choices evenly", () => {
    expect(normalizeAnswer(2, 3)).toBe(50);
  });

  it("is unchanged from the old formula at five choices", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(normalizeAnswer(rating, 5)).toBe(((rating - 1) / 4) * 100);
    }
  });

  it("rejects a rating below 1", () => {
    expect(() => normalizeAnswer(0, 5)).toThrow();
  });

  it("rejects a rating above the choice count", () => {
    expect(() => normalizeAnswer(4, 3)).toThrow();
  });

  it("rejects a choice count below two", () => {
    // A one-choice question carries no information and would divide by zero.
    expect(() => normalizeAnswer(1, 1)).toThrow();
  });
});

describe("tierForLevel", () => {
  // Position-based, evenly distributed across the four tier names, not the
  // original fixed 25/50/75 cutoffs on the normalized score -- those
  // collided at five choices, where a boundary landing exactly on a level
  // put both 4 and 5 in "Excellent". Distributing by position instead
  // guarantees no tier ever absorbs more than one extra level, and always
  // anchors the bottom choice at Poor and the top at Excellent for any
  // choiceCount of 4 or more (see lib/scoring.ts for the exact algorithm).
  it("distributes five choices with the extra level at the bottom, not a duplicate at the top", () => {
    expect(tierForLevel(1, 5)).toBe("Poor");
    expect(tierForLevel(2, 5)).toBe("Poor");
    expect(tierForLevel(3, 5)).toBe("Fair");
    expect(tierForLevel(4, 5)).toBe("Good");
    expect(tierForLevel(5, 5)).toBe("Excellent");
  });

  it("gives four choices one tier each, with no collision at all", () => {
    expect(tierForLevel(1, 4)).toBe("Poor");
    expect(tierForLevel(2, 4)).toBe("Fair");
    expect(tierForLevel(3, 4)).toBe("Good");
    expect(tierForLevel(4, 4)).toBe("Excellent");
  });

  it("puts the extremes of a two-choice question at Poor and Good -- Excellent needs a 4th level to be reachable", () => {
    expect(tierForLevel(1, 2)).toBe("Poor");
    expect(tierForLevel(2, 2)).toBe("Good");
  });

  it("puts the middle of a three-choice question at Fair", () => {
    expect(tierForLevel(2, 3)).toBe("Fair");
  });
});

describe("scoreAssessment with a supplied question set", () => {
  it("scores a three-choice set on the same 0-100 scale", () => {
    const questions = minimalSet(3);
    const result = scoreAssessment({ W1: 2, A1: 2, V1: 2, E1: 2 }, questions);
    for (const g of result.gaps) expect(g.score).toBe(50);
    expect(result.overallScore).toBe(50);
  });

  it("weighs a three-choice and a five-choice question equally in a gap", () => {
    // W1 three-choice answered at the top (100), W2 five-choice answered
    // at the bottom (0). The gap must be their plain average, 50.
    const questions = [
      q("W1", "wealth", 3),
      { ...q("W2", "wealth", 5), id: "W2" },
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 3, W2: 1, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.score).toBe(50);
  });

  it("handles gaps with different numbers of questions", () => {
    const questions = [
      q("W1", "wealth", 5),
      q("W2", "wealth", 5),
      q("W3", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 5, W2: 5, W3: 1, A1: 1, V1: 1, E1: 1 },
      questions
    );
    // Wealth: (100 + 100 + 0) / 3 = 66.67 -> 67
    expect(result.gaps.find((g) => g.gap === "wealth")!.score).toBe(67);
    // Overall: (67 + 0 + 0 + 0) / 4 = 16.75 -> 17
    expect(result.overallScore).toBe(17);
  });

  it("throws a named error rather than returning NaN when a gap has no questions", () => {
    // Previously this divided by zero and wrote NaN into an Int column.
    const questions = [
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    expect(() => scoreAssessment({ A1: 3, V1: 3, E1: 3 }, questions)).toThrow(
      /wealth/i
    );
  });

  it("rejects an answer above that question's own choice count, naming the offending question", () => {
    // Once question sets are editable with mixed choice counts, a
    // generic "Rating must be between 1 and 3, got 5" gives a prospect
    // (and staff debugging a bad submission) no way to know which of
    // many questions is at fault. The thrown message must name it.
    const questions = minimalSet(3);
    expect(() =>
      scoreAssessment({ W1: 5, A1: 2, V1: 2, E1: 2 }, questions)
    ).toThrow(/W1/);
  });
});
