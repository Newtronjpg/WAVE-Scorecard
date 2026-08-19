import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mergeQuestions,
  resolveQuestions,
  getPublishedQuestions,
  getDraftQuestions,
  seedDraftQuestions,
  getQuestionsForVersion,
} from "@/lib/questionContent";
import { QUESTIONS } from "@/lib/questions";
import { factoryQuestionSet, toStored, withDerivedTiers } from "@/lib/questionSet";

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
//
// Every model the file under test touches is stubbed here, even the ones
// individual tests don't care about. An undefined `db.questionDraft` or
// `db.questionOverride` would throw when called, get swallowed by one of
// this file's own defensive catch blocks, and make a test pass having
// exercised the crash path instead of the path it names (see the same
// hazard called out in tests/submitRoute.test.ts).
const findFirstVersionMock = vi.fn();
const findUniqueVersionMock = vi.fn();
const findUniqueDraftMock = vi.fn();
const upsertDraftMock = vi.fn();
const findManyOverrideMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    questionSetVersion: {
      findFirst: (...args: unknown[]) => findFirstVersionMock(...args),
      findUnique: (...args: unknown[]) => findUniqueVersionMock(...args),
    },
    questionDraft: {
      findUnique: (...args: unknown[]) => findUniqueDraftMock(...args),
      upsert: (...args: unknown[]) => upsertDraftMock(...args),
    },
    questionOverride: {
      findMany: (...args: unknown[]) => findManyOverrideMock(...args),
    },
  },
}));

describe("getPublishedQuestions", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    findFirstVersionMock.mockReset();
    findManyOverrideMock.mockReset().mockResolvedValue([]);
    consoleErrorSpy.mockClear();
  });

  it("falls back to the factory questions when no published version exists", async () => {
    findFirstVersionMock.mockResolvedValue(null);

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(withDerivedTiers(toStored(QUESTIONS)));
  });

  it("returns the stored questions and version number for a valid published version", async () => {
    findFirstVersionMock.mockResolvedValue({
      version: 3,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });

    const result = await getPublishedQuestions();

    expect(result.version).toBe(3);
    expect(result.questions[0].levels[0].tier).toBe("Poor");
  });

  it("serves the highest version when several exist", async () => {
    // findFirst + orderBy desc is how "highest wins" is implemented; a
    // fake row with version 7 standing in for "the highest of several"
    // is what a real ORDER BY version DESC LIMIT 1 would hand back.
    findFirstVersionMock.mockResolvedValue({
      version: 7,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });

    const result = await getPublishedQuestions();

    expect(result.version).toBe(7);
  });

  it("falls back to the factory questions and logs when the read rejects", async () => {
    findFirstVersionMock.mockRejectedValue(
      new Error("The table `public.question_set_versions` does not exist.")
    );

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(withDerivedTiers(toStored(QUESTIONS)));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("falls back to the factory questions and logs when the stored set is invalid", async () => {
    findFirstVersionMock.mockResolvedValue({
      version: 2,
      questions: [{ id: "W1", gap: "wealth" }],
      note: null,
      publishedAt: new Date(),
    });

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(withDerivedTiers(toStored(QUESTIONS)));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  // Regression: before this, getResolvedQuestions read QuestionOverride
  // rows directly, so wording edits already live in production drove the
  // public assessment. Delegating straight to bare QUESTIONS here would
  // silently revert every one of those edits the moment this shipped,
  // for every prospect, until the first publish. Overrides must still
  // apply whenever there is no published version to prefer instead.
  it("merges lingering QuestionOverride wording into the factory set when there is no published version", async () => {
    findFirstVersionMock.mockResolvedValue(null);
    findManyOverrideMock.mockResolvedValue([
      { questionId: first.id, statement: "Carried-forward wording.", levels: null },
    ]);

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions[0].statement).toBe("Carried-forward wording.");
  });

  it("degrades all the way to bare factory questions if the override read also fails", async () => {
    findFirstVersionMock.mockResolvedValue(null);
    findManyOverrideMock.mockRejectedValue(new Error("overrides table unreachable"));

    const result = await getPublishedQuestions();

    expect(result.version).toBeNull();
    expect(result.questions).toEqual(QUESTIONS);
  });
});

// getQuestionsForVersion resolves the EXACT question set a specific
// published version represented, independent of whatever is live right
// now -- this is what lets /api/submit score a run against the version
// the respondent actually loaded rather than whatever a concurrent
// publish made current by the time they hit submit.
//
// version === null describes only the "nothing has ever been published"
// state a prospect could have loaded pre-first-publish. Recomputing
// factoryWithOverrides() later reproduces that state byte-for-byte
// because nothing writes to QuestionOverride any more (that write path
// was retired by the versioned editor) -- it is frozen, deterministic
// input, unaffected by any publish that happens afterward.
describe("getQuestionsForVersion", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    findUniqueVersionMock.mockReset();
    findManyOverrideMock.mockReset().mockResolvedValue([]);
    consoleErrorSpy.mockClear();
  });

  it("returns the factory-with-overrides set when version is null, without touching QuestionSetVersion", async () => {
    findManyOverrideMock.mockResolvedValue([
      { questionId: first.id, statement: "Carried forward.", levels: null },
    ]);

    const result = await getQuestionsForVersion(null);

    expect(result?.[0].statement).toBe("Carried forward.");
    expect(findUniqueVersionMock).not.toHaveBeenCalled();
  });

  it("returns the exact historical snapshot for a specific version by primary-key lookup", async () => {
    findUniqueVersionMock.mockResolvedValue({
      version: 3,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });

    const result = await getQuestionsForVersion(3);

    expect(findUniqueVersionMock).toHaveBeenCalledWith({ where: { version: 3 } });
    expect(result).toEqual(withDerivedTiers(toStored(QUESTIONS)));
  });

  it("returns null when the requested version does not exist", async () => {
    findUniqueVersionMock.mockResolvedValue(null);

    const result = await getQuestionsForVersion(99);

    expect(result).toBeNull();
  });

  it("returns null and logs when the stored version fails validation", async () => {
    findUniqueVersionMock.mockResolvedValue({
      version: 2,
      questions: [{ id: "W1", gap: "wealth" }],
      note: null,
      publishedAt: new Date(),
    });

    const result = await getQuestionsForVersion(2);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("returns null and logs when the read rejects", async () => {
    findUniqueVersionMock.mockRejectedValue(new Error("question_set_versions unreachable"));

    const result = await getQuestionsForVersion(4);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("getDraftQuestions", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    findUniqueDraftMock.mockReset();
    findFirstVersionMock.mockReset();
    findManyOverrideMock.mockReset().mockResolvedValue([]);
    consoleErrorSpy.mockClear();
  });

  it("returns the draft row's questions, its updatedAt, and source \"draft\" when it is valid", async () => {
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: factoryQuestionSet(),
      updatedAt,
    });

    const result = await getDraftQuestions();

    expect(result.source).toBe("draft");
    expect(result.updatedAt).toEqual(updatedAt);
    expect(result.questions[0].levels[0].tier).toBe("Poor");
  });

  it("falls back to the published set with source \"published\" when there is no draft row", async () => {
    findUniqueDraftMock.mockResolvedValue(null);
    findFirstVersionMock.mockResolvedValue({
      version: 5,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });

    const result = await getDraftQuestions();

    expect(result.source).toBe("published");
    expect(result.updatedAt).toBeNull();
  });

  it("falls back to the factory set with source \"factory\" when there is no draft and no published version", async () => {
    findUniqueDraftMock.mockResolvedValue(null);
    findFirstVersionMock.mockResolvedValue(null);

    const result = await getDraftQuestions();

    expect(result.source).toBe("factory");
    expect(result.updatedAt).toBeNull();
    expect(result.questions).toEqual(withDerivedTiers(toStored(QUESTIONS)));
  });

  // A draft row that EXISTS but fails validation must not be reported as
  // updatedAt: null in a way that is indistinguishable from "no draft was
  // ever written" -- Task 7's 409 check, and the editor's corruption
  // warning, both need to know there IS a row it failed to read, not that
  // there is nothing to conflict with. The timestamp on the bad row must
  // not leak through either, since it cannot be trusted to describe
  // content nobody could parse. source "draft" is the one value that
  // signals this distinctly from the "no draft row at all" case below,
  // even though the served CONTENT is still the safe published/factory
  // fallback.
  it("reports source \"draft\" (with updatedAt null) when the draft row exists but fails validation", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: [{ id: "W1", gap: "wealth" }],
      updatedAt: new Date("2020-01-01T00:00:00Z"),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const result = await getDraftQuestions();

    expect(result.source).toBe("draft");
    expect(result.updatedAt).toBeNull();
    // Not a byte-exact QUESTIONS comparison: this path runs the factory
    // set through withDerivedTiers (via factoryWithOverrides, merging in
    // zero overrides), which recomputes each level's tier fresh rather
    // than trusting whatever lib/questions.ts has baked in -- see
    // lib/scoring.ts's tierForLevel for why those two are allowed to
    // differ.
    expect(result.questions).toEqual(withDerivedTiers(toStored(QUESTIONS)));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("falls back past a draft read error to the published/factory chain", async () => {
    findUniqueDraftMock.mockRejectedValue(new Error("draft table unreachable"));
    findFirstVersionMock.mockResolvedValue(null);

    const result = await getDraftQuestions();

    expect(result.source).toBe("factory");
    expect(result.updatedAt).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("seedDraftQuestions", () => {
  beforeEach(() => {
    findUniqueDraftMock.mockReset();
    findFirstVersionMock.mockReset();
    findManyOverrideMock.mockReset().mockResolvedValue([]);
    upsertDraftMock.mockReset();
  });

  it("returns the existing draft row's questions and updatedAt without writing", async () => {
    const updatedAt = new Date("2026-01-01T00:00:00Z");
    const stored = factoryQuestionSet();
    findUniqueDraftMock.mockResolvedValue({ id: "draft", questions: stored, updatedAt });

    const result = await seedDraftQuestions();

    expect(result.updatedAt).toEqual(updatedAt);
    expect(result.questions).toEqual(stored);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });

  // Finding 1: an existing draft row is validated, not trusted blindly.
  // A corrupt row (hand-edited, a partial write) must not be handed to
  // the admin editor typed as StoredQuestion[] when it structurally
  // isn't one -- that is what turns "levels.map is not a function" into
  // the admin's own repair tool being what crashes. Falling through to
  // the reseed path instead overwrites the corrupt row, which makes this
  // self-healing.
  it("reseeds and overwrites when the existing draft row fails validation", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: [{ id: "W1", gap: "wealth" }],
      updatedAt: new Date("2020-01-01T00:00:00Z"),
    });
    findFirstVersionMock.mockResolvedValue(null);
    const writtenAt = new Date("2026-02-02T00:00:00Z");
    upsertDraftMock.mockResolvedValue({ id: "draft", questions: [], updatedAt: writtenAt });

    const result = await seedDraftQuestions();

    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
    expect(result.updatedAt).toEqual(writtenAt);
    expect(result.questions).toEqual(factoryQuestionSet());
  });

  it("seeds from the highest published version when there is no draft row", async () => {
    findUniqueDraftMock.mockResolvedValue(null);
    findFirstVersionMock.mockResolvedValue({
      version: 4,
      questions: factoryQuestionSet(),
      note: null,
      publishedAt: new Date(),
    });
    const writtenAt = new Date("2026-03-03T00:00:00Z");
    upsertDraftMock.mockResolvedValue({ id: "draft", questions: [], updatedAt: writtenAt });

    const result = await seedDraftQuestions();

    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
    expect(result.updatedAt).toEqual(writtenAt);
    expect(result.questions).toEqual(factoryQuestionSet());
  });

  it("seeds from the factory defaults merged with QuestionOverride rows when there is no draft and no published version", async () => {
    findUniqueDraftMock.mockResolvedValue(null);
    findFirstVersionMock.mockResolvedValue(null);
    findManyOverrideMock.mockResolvedValue([
      { questionId: first.id, statement: "Carried forward.", levels: null },
    ]);
    const writtenAt = new Date("2026-04-04T00:00:00Z");
    upsertDraftMock.mockResolvedValue({ id: "draft", questions: [], updatedAt: writtenAt });

    const result = await seedDraftQuestions();

    expect(result.questions[0].statement).toBe("Carried forward.");
    expect(result.updatedAt).toEqual(writtenAt);
  });

  // Finding 2: this is a write path with no honest degraded mode -- its
  // return type promises a real Date, and fabricating one would poison
  // Task 7's optimistic-concurrency check. It throws by design, and
  // callers are expected to handle that.
  it("throws rather than fabricating a result when the draft table is unreachable", async () => {
    findUniqueDraftMock.mockRejectedValue(new Error("draft table unreachable"));

    await expect(seedDraftQuestions()).rejects.toThrow("draft table unreachable");
  });
});
