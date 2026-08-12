import { describe, it, expect } from "vitest";
import { mergeQuestions } from "@/lib/questionContent";
import { QUESTIONS } from "@/lib/questions";

// Admin edits are stored as OVERRIDES on top of lib/questions.ts, which
// keeps owning structure: which questions exist, their gap, the 1-5
// scale, and each level's tier. Only wording is overridable.
//
// The merge must therefore be total and defensive: any malformed or
// unrecognised override is ignored in favour of the code default, never
// thrown on. A bad row in the database must not be able to take down the
// assessment for every prospect.

const first = QUESTIONS[0];

function fullLevels(prefix: string) {
  return [1, 2, 3, 4, 5].map((value) => ({
    value,
    label: `${prefix} label ${value}`,
    description: `${prefix} description ${value}`,
  }));
}

describe("mergeQuestions", () => {
  it("returns the defaults unchanged when there are no overrides", () => {
    expect(mergeQuestions(QUESTIONS, [])).toEqual(QUESTIONS);
  });

  it("preserves the number of questions and their order", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: "Rewritten.", levels: null },
    ]);
    expect(merged).toHaveLength(QUESTIONS.length);
    expect(merged.map((q) => q.id)).toEqual(QUESTIONS.map((q) => q.id));
  });

  it("applies a statement override", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: "We know our number.", levels: null },
    ]);
    expect(merged[0].statement).toBe("We know our number.");
  });

  it("applies a levels override to labels and descriptions", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: null, levels: fullLevels("new") },
    ]);
    expect(merged[0].levels[0].label).toBe("new label 1");
    expect(merged[0].levels[4].description).toBe("new description 5");
  });

  it("leaves levels at their defaults when only the statement is overridden", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: "Changed.", levels: null },
    ]);
    expect(merged[0].levels).toEqual(first.levels);
  });

  it("leaves the statement at its default when only levels are overridden", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: null, levels: fullLevels("x") },
    ]);
    expect(merged[0].statement).toBe(first.statement);
  });

  it("never lets an override change a level's tier", () => {
    // Tiers drive tierForRating() and the Combo Rules transcribed from
    // the source workbook. They are structure, not wording.
    const merged = mergeQuestions(QUESTIONS, [
      {
        questionId: first.id,
        statement: null,
        levels: [1, 2, 3, 4, 5].map((value) => ({
          value,
          tier: "Excellent",
          label: "l",
          description: "d",
        })),
      },
    ]);
    expect(merged[0].levels.map((l) => l.tier)).toEqual(
      first.levels.map((l) => l.tier)
    );
  });

  it("never lets an override change a question's gap or id", () => {
    const merged = mergeQuestions(QUESTIONS, [
      {
        questionId: first.id,
        statement: null,
        levels: null,
        gap: "earnings",
        id: "HACKED",
      } as never,
    ]);
    expect(merged[0].id).toBe(first.id);
    expect(merged[0].gap).toBe(first.gap);
  });

  it("ignores an override for a question id that does not exist", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: "NOPE", statement: "ignored", levels: null },
    ]);
    expect(merged).toEqual(QUESTIONS);
  });

  it("ignores a levels override that is not an array", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: null, levels: "garbage" },
    ]);
    expect(merged[0].levels).toEqual(first.levels);
  });

  it("ignores a levels override that does not have all five levels", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: null, levels: fullLevels("x").slice(0, 3) },
    ]);
    expect(merged[0].levels).toEqual(first.levels);
  });

  it("ignores a levels override with a missing label", () => {
    const broken = fullLevels("x").map((l, i) =>
      i === 2 ? { value: l.value, description: l.description } : l
    );
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: null, levels: broken },
    ]);
    expect(merged[0].levels).toEqual(first.levels);
  });

  it("ignores an empty or whitespace-only statement override", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: "   ", levels: null },
    ]);
    expect(merged[0].statement).toBe(first.statement);
  });

  it("does not mutate the defaults it was given", () => {
    const before = JSON.parse(JSON.stringify(QUESTIONS));
    mergeQuestions(QUESTIONS, [
      { questionId: first.id, statement: "Changed.", levels: fullLevels("y") },
    ]);
    expect(QUESTIONS).toEqual(before);
  });

  it("applies overrides to several questions at once", () => {
    const merged = mergeQuestions(QUESTIONS, [
      { questionId: QUESTIONS[0].id, statement: "One.", levels: null },
      { questionId: QUESTIONS[5].id, statement: "Two.", levels: null },
    ]);
    expect(merged[0].statement).toBe("One.");
    expect(merged[5].statement).toBe("Two.");
  });
});
