import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeQuestions, resolveQuestions } from "@/lib/questionContent";
import { QUESTIONS } from "@/lib/questions";
import { factoryQuestionSet } from "@/lib/questionSet";

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

describe("resolveQuestions", () => {
  it("returns tier-annotated questions for a valid stored set", () => {
    const questions = resolveQuestions(factoryQuestionSet());
    expect(questions).not.toBeNull();
    expect(questions![0].levels[0].tier).toBe("Poor");
  });

  it("returns null for a stored set that fails validation", () => {
    // A stored set can be invalid even though the API validated it on the
    // way in: an older version, a hand-edited row, a partial write. The
    // caller falls back to the factory set rather than serving this.
    expect(resolveQuestions([{ id: "W1", gap: "wealth" }])).toBeNull();
  });

  it("returns null rather than throwing for junk", () => {
    expect(resolveQuestions("not a question set")).toBeNull();
    expect(resolveQuestions(null)).toBeNull();
  });
});

// Asserts the fallback chain, which is the safety-critical part: a
// missing table (the 2026-08-12 outage), a read error, or an invalid
// stored set must each degrade to the factory questions rather than
// breaking the assessment for every prospect.

const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    questionSetVersion: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

describe("getPublishedQuestions", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    findFirstMock.mockReset();
    consoleErrorSpy.mockClear();
  });

  it("falls back to the factory questions when no published version exists", async () => {
    findFirstMock.mockResolvedValue(null);
    const { getPublishedQuestions } = await import("@/lib/questionContent");

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(QUESTIONS);
  });

  it("returns the stored questions and version number for a valid published version", async () => {
    findFirstMock.mockResolvedValue({
      version: 3,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });
    const { getPublishedQuestions } = await import("@/lib/questionContent");

    const result = await getPublishedQuestions();

    expect(result.version).toBe(3);
    expect(result.questions[0].levels[0].tier).toBe("Poor");
  });

  it("asks the database for the highest version so the newest publish wins", async () => {
    findFirstMock.mockResolvedValue({
      version: 7,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });
    const { getPublishedQuestions } = await import("@/lib/questionContent");

    const result = await getPublishedQuestions();

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { version: "desc" } })
    );
    expect(result.version).toBe(7);
  });

  it("falls back to the factory questions and logs when the read rejects", async () => {
    findFirstMock.mockRejectedValue(
      new Error("The table `public.question_set_versions` does not exist.")
    );
    const { getPublishedQuestions } = await import("@/lib/questionContent");

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(QUESTIONS);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("falls back to the factory questions and logs when the stored set is invalid", async () => {
    findFirstMock.mockResolvedValue({
      version: 2,
      questions: [{ id: "W1", gap: "wealth" }],
      note: null,
      publishedAt: new Date(),
    });
    const { getPublishedQuestions } = await import("@/lib/questionContent");

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(QUESTIONS);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
