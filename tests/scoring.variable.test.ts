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

// The results page now names each gap's weakest question, so the
// per-question normalized scores that scoreAssessment already computes
// have to survive as far as the caller instead of being averaged and
// discarded.
describe("per-gap band", () => {
  it("labels each gap with the same band bandFor would give its score", () => {
    const questions = [
      q("W1", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    // 1 -> 0 (Poor), 2 -> 25 (Fair), 4 -> 75 (Great), 3 -> 50 (Good)
    const result = scoreAssessment({ W1: 1, A1: 2, V1: 4, E1: 3 }, questions);

    const byGap = Object.fromEntries(result.gaps.map((g) => [g.gap, g]));
    expect(byGap.wealth.band.label).toBe("Poor");
    expect(byGap.accounting.band.label).toBe("Fair");
    expect(byGap.value.band.label).toBe("Great");
    expect(byGap.earnings.band.label).toBe("Good");
  });

  it("bands each gap off its own score, not the overall score", () => {
    // Overall here is (0 + 100 + 100 + 100) / 4 = 75, "Great" -- while
    // wealth itself is 0, "Poor". A single shared band would show Great
    // against a zeroed gap.
    const questions = [
      q("W1", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment({ W1: 1, A1: 5, V1: 5, E1: 5 }, questions);

    expect(result.overallScore).toBe(75);
    expect(result.band.label).toBe("Great");
    expect(result.gaps.find((g) => g.gap === "wealth")!.band.label).toBe("Poor");
  });
});

describe("lowestQuestionId", () => {
  it("names the weakest question in each gap", () => {
    const questions = [
      q("W1", "wealth", 5),
      q("W2", "wealth", 5),
      q("W3", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 5, W2: 2, W3: 4, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.lowestQuestionId).toBe("W2");
  });

  it("compares normalized scores, not raw ratings, across mixed choice counts", () => {
    // Both answered "2", but 2-of-3 normalizes to 50 while 2-of-5
    // normalizes to 25. Comparing raw ratings would tie and hand it to
    // W1; only the normalized comparison picks W2.
    const questions = [
      q("W1", "wealth", 3),
      q("W2", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 2, W2: 2, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.lowestQuestionId).toBe("W2");
  });

  it("breaks a tie by position in the question array, not by id", () => {
    const questions = [
      q("W1", "wealth", 5),
      q("W2", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 1, W2: 1, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.lowestQuestionId).toBe("W1");
  });

  it("gives the tie to whichever question the admin ordered first", () => {
    // Same two tied questions as above with the array order reversed.
    // An implementation that sorted by id, or leaned on the factory
    // order, would still answer "W1" here and be wrong -- the boss's
    // rule is "the first one in question order".
    const questions = [
      q("W2", "wealth", 5),
      q("W1", "wealth", 5),
      q("A1", "accounting", 5),
      q("V1", "value", 5),
      q("E1", "earnings", 5),
    ];
    const result = scoreAssessment(
      { W1: 1, W2: 1, A1: 3, V1: 3, E1: 3 },
      questions
    );
    expect(result.gaps.find((g) => g.gap === "wealth")!.lowestQuestionId).toBe("W2");
  });

  it("names the only question in a single-question gap", () => {
    const result = scoreAssessment({ W1: 3, A1: 3, V1: 3, E1: 3 }, minimalSet(5));
    for (const g of result.gaps) {
      expect(g.lowestQuestionId).toBe(g.gap === "wealth" ? "W1" : g.lowestQuestionId);
      expect(g.lowestQuestionId).toBeTruthy();
    }
  });

  it("reports the raw rating of the lowest question, not its normalized score", () => {
    // The results page picks which closing sentence to use from the RAW
    // rating (1-2 vs 3 vs 4), matching the workbook's
    // MIN(Assessment!$F$15:$F$18) -- so the raw value has to survive
    // alongside the normalized one.
    const questions = [
      q("W1", "wealth", 4),
      q("W2", "wealth", 4),
      q("A1", "accounting", 4),
      q("V1", "value", 4),
      q("E1", "earnings", 4),
    ];
    const result = scoreAssessment({ W1: 4, W2: 3, A1: 4, V1: 4, E1: 4 }, questions);
    const wealth = result.gaps.find((g) => g.gap === "wealth")!;
    expect(wealth.lowestQuestionId).toBe("W2");
    expect(wealth.lowestRating).toBe(3);
  });

  it("reports a lowest rating of 4 when every answer in the gap is the top choice", () => {
    const result = scoreAssessment({ W1: 4, A1: 4, V1: 4, E1: 4 }, minimalSet(4));
    for (const g of result.gaps) expect(g.lowestRating).toBe(4);
  });

  it("still names a question when every answer in the gap is perfect", () => {
    // A gap can max out; the results page still has to render a
    // paragraph, so there is always a "lowest" even at 100.
    const result = scoreAssessment({ W1: 5, A1: 5, V1: 5, E1: 5 }, minimalSet(5));
    expect(result.gaps.find((g) => g.gap === "wealth")!.lowestQuestionId).toBe("W1");
  });
});
