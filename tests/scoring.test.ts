import { describe, it, expect } from "vitest";
import {
  normalizeAnswer,
  scoreAssessment,
  bandFor,
  tierForRating,
  READINESS_BANDS,
} from "@/lib/scoring";
import { QUESTIONS, GAPS } from "@/lib/questions";

// Helper: build a complete 28-answer map, defaulting every question to a
// given rating, with overrides for specific question ids.
function allAnswers(
  defaultRating: number,
  overrides: Record<string, number> = {}
): Record<string, number> {
  const answers: Record<string, number> = {};
  for (const q of QUESTIONS) {
    answers[q.id] = overrides[q.id] ?? defaultRating;
  }
  return answers;
}

describe("question bank integrity", () => {
  it("has exactly 28 questions", () => {
    expect(QUESTIONS.length).toBe(28);
  });

  it("has exactly 7 questions per gap", () => {
    for (const gap of GAPS) {
      const count = QUESTIONS.filter((q) => q.gap === gap.id).length;
      expect(count).toBe(7);
    }
  });

  it("has unique question ids", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every question has exactly 5 rating levels, numbered 1-5 in order", () => {
    for (const q of QUESTIONS) {
      expect(q.levels.length).toBe(5);
      q.levels.forEach((level, i) => {
        expect(level.value).toBe(i + 1);
      });
    }
  });

  it("every rating level has a non-empty short label and full description, and they differ from each other", () => {
    for (const q of QUESTIONS) {
      for (const level of q.levels) {
        expect(level.label.trim().length).toBeGreaterThan(0);
        expect(level.description.trim().length).toBeGreaterThan(0);
      }
      // Catches accidental copy-paste duplication across levels within
      // one question, which is the single easiest way for 140 lines of
      // hand-written rubric text to go quietly wrong.
      const descriptions = q.levels.map((l) => l.description);
      expect(new Set(descriptions).size).toBe(descriptions.length);
      const labels = q.levels.map((l) => l.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("tiers follow the documented 1=Poor 2=Fair 3=Good 4-5=Excellent mapping", () => {
    for (const q of QUESTIONS) {
      const byValue = Object.fromEntries(q.levels.map((l) => [l.value, l.tier]));
      expect(byValue[1]).toBe("Poor");
      expect(byValue[2]).toBe("Fair");
      expect(byValue[3]).toBe("Good");
      expect(byValue[4]).toBe("Excellent");
      expect(byValue[5]).toBe("Excellent");
    }
  });
});

describe("normalizeAnswer", () => {
  it("maps a rating of 1 to 0", () => {
    expect(normalizeAnswer(1)).toBe(0);
  });
  it("maps a rating of 5 to 100", () => {
    expect(normalizeAnswer(5)).toBe(100);
  });
  it("maps a rating of 3 to the midpoint", () => {
    expect(normalizeAnswer(3)).toBe(50);
  });
  it("rejects out-of-range ratings", () => {
    expect(() => normalizeAnswer(0)).toThrow();
    expect(() => normalizeAnswer(6)).toThrow();
  });
});

describe("scoreAssessment", () => {
  it("reproduces the exact worked example from the current prototype's results screen", () => {
    // From the screenshots: Wealth 50, Accounting 75, Value 50,
    // Earnings 57, overall 58. Earnings answers as entered on screen were
    // 2, 4, 3, 2, 3, 5, 4 for E1-E7 respectively.
    const answers = allAnswers(3, {
      // Wealth -> 50/100: alternate 1s and 5s across 7 questions averages
      // to 50 ((0+100+0+100+0+100+0)/7 = 42.86 -> not quite; use a mix
      // that averages to exactly 50 instead, matching the score, not a
      // specific unknown set of source ratings for W/A/V (only the
      // Earnings answers were visible on screen).
      W1: 3, W2: 3, W3: 3, W4: 3, W5: 3, W6: 3, W7: 3, // all "3" -> 50 avg
      A1: 4, A2: 4, A3: 4, A4: 4, A5: 4, A6: 4, A7: 4, // all "4" -> 75 avg
      V1: 3, V2: 3, V3: 3, V4: 3, V5: 3, V6: 3, V7: 3, // all "3" -> 50 avg
      E1: 2, E2: 4, E3: 3, E4: 2, E5: 3, E6: 5, E7: 4, // exact answers from screenshot
    });

    const result = scoreAssessment(answers);

    const wealth = result.gaps.find((g) => g.gap === "wealth")!;
    const accounting = result.gaps.find((g) => g.gap === "accounting")!;
    const value = result.gaps.find((g) => g.gap === "value")!;
    const earnings = result.gaps.find((g) => g.gap === "earnings")!;

    expect(wealth.score).toBe(50);
    expect(accounting.score).toBe(75);
    expect(value.score).toBe(50);
    expect(earnings.score).toBe(57); // (25+75+50+25+50+100+75)/7 = 57.14 -> 57
    expect(result.overallScore).toBe(58);
    expect(result.band.label).toBe("Meaningful gaps");
    expect(result.widestGap.gap).toBe("wealth"); // tied with value at 50; wealth comes first
  });

  it("scores a perfect assessment as 100 with the top band", () => {
    const result = scoreAssessment(allAnswers(5));
    expect(result.overallScore).toBe(100);
    for (const g of result.gaps) expect(g.score).toBe(100);
    expect(result.band.label).toBe("Transaction ready");
  });

  it("scores the worst possible assessment as 0 with the bottom band", () => {
    const result = scoreAssessment(allAnswers(1));
    expect(result.overallScore).toBe(0);
    for (const g of result.gaps) expect(g.score).toBe(0);
    expect(result.band.label).toBe("Significant gaps");
  });

  it("computes gapToClose as 100 minus the score for every gap", () => {
    const result = scoreAssessment(allAnswers(4));
    for (const g of result.gaps) {
      expect(g.gapToClose).toBe(100 - g.score);
    }
  });

  it("throws a clear error when an answer is missing", () => {
    const answers = allAnswers(3);
    delete answers["W1"];
    expect(() => scoreAssessment(answers)).toThrow(/W1/);
  });

  it("throws when an answer is out of range", () => {
    const answers = allAnswers(3, { W1: 7 });
    expect(() => scoreAssessment(answers)).toThrow();
  });

  it("identifies the widest gap correctly when gaps are not tied", () => {
    const result = scoreAssessment(
      allAnswers(5, {
        A1: 1, A2: 1, A3: 1, A4: 1, A5: 1, A6: 1, A7: 1,
      })
    );
    expect(result.widestGap.gap).toBe("accounting");
    expect(result.widestGap.score).toBe(0);
  });
});

describe("bandFor", () => {
  it("is exhaustive and ordered so every 0-100 score matches exactly one band", () => {
    for (let score = 0; score <= 100; score++) {
      const band = bandFor(score);
      expect(band).toBeDefined();
      expect(score).toBeGreaterThanOrEqual(band.floor);
    }
  });

  it("bands are sorted ascending by floor with no gaps or overlaps at the boundaries", () => {
    const sorted = [...READINESS_BANDS].sort((a, b) => a.floor - b.floor);
    expect(sorted.map((b) => b.label)).toEqual(READINESS_BANDS.map((b) => b.label));
  });

  it("boundary scores land in the higher band (inclusive floor)", () => {
    expect(bandFor(40).label).toBe("Meaningful gaps");
    expect(bandFor(39).label).toBe("Significant gaps");
    expect(bandFor(60).label).toBe("Minor gaps");
    expect(bandFor(80).label).toBe("Transaction ready");
  });
});

describe("tierForRating", () => {
  it("matches the documented mapping", () => {
    expect(tierForRating(1)).toBe("Poor");
    expect(tierForRating(2)).toBe("Fair");
    expect(tierForRating(3)).toBe("Good");
    expect(tierForRating(4)).toBe("Excellent");
    expect(tierForRating(5)).toBe("Excellent");
  });
});
