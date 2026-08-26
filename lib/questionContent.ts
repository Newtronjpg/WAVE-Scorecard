import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { QUESTIONS, type Question, type RatingLevel } from "./questions";
import {
  validateQuestionSet,
  withDerivedTiers,
  toStored,
  factoryQuestionSet,
  type StoredQuestion,
} from "./questionSet";

// Resolves the question set shown to a prospect and the one edited in the
// admin UI. The database owns the published set; lib/questions.ts is only
// the factory default and read-path fallback (missing table, bad data) --
// not theoretical, a missing table caused a real outage here. Every value
// read from the database goes through validateQuestionSet first.
//
// Only the read paths (resolveQuestions, getPublishedQuestions,
// getQuestionsForVersion, getDraftQuestions) get that fallback.
// seedDraftQuestions is a write path and throws instead, since its
// contract needs a real timestamp and a fabricated one would break the
// optimistic-concurrency check that depends on it.

export interface QuestionOverrideRow {
  questionId: string;
  statement: string | null;
  levels: unknown;
}

function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Accepts a levels override only if it is complete: an array of exactly
// five entries, each carrying usable label and description text. A
// partial array is rejected wholesale rather than merged entry by entry,
// so a half-written override can never leave a question showing three
// new levels and two old ones.
function usableLevels(raw: unknown): { label: string; description: string }[] | null {
  if (!Array.isArray(raw) || raw.length !== 5) return null;

  const cleaned = raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const { label, description } = entry as Record<string, unknown>;
    if (!isUsableText(label) || !isUsableText(description)) return null;
    return { label: label.trim(), description: description.trim() };
  });

  if (cleaned.some((entry) => entry === null)) return null;
  return cleaned as { label: string; description: string }[];
}

// Pure: no database, no environment. Takes the defaults and the override
// rows and returns a new array, leaving its inputs untouched. Retained
// only for seedDraftQuestions, the one-time migration path off the old
// QuestionOverride table.
export function mergeQuestions(
  defaults: Question[],
  overrides: QuestionOverrideRow[]
): Question[] {
  const byId = new Map<string, QuestionOverrideRow>();
  for (const override of overrides) {
    if (override && typeof override.questionId === "string") {
      byId.set(override.questionId, override);
    }
  }

  return defaults.map((question) => {
    const override = byId.get(question.id);
    if (!override) return question;

    const statement = isUsableText(override.statement)
      ? override.statement.trim()
      : question.statement;

    const levelText = usableLevels(override.levels);

    // value and tier are always taken from the default. Only label and
    // description can come from an override.
    const levels: RatingLevel[] = levelText
      ? question.levels.map((level, index) => ({
          ...level,
          label: levelText[index].label,
          description: levelText[index].description,
        }))
      : question.levels;

    return { ...question, statement, levels };
  });
}

// Pure: validate, then derive tiers. Never throws -- returns null for
// anything that fails validateQuestionSet, including a shape that isn't
// even an array. Order matters here: withDerivedTiers has no runtime
// guard of its own (it throws on a question with fewer than two levels),
// so it must never run on unvalidated input.
export function resolveQuestions(raw: unknown): Question[] | null {
  const result = validateQuestionSet(raw);
  if (!result.ok) return null;
  return withDerivedTiers(result.questions);
}

// The factory set with any still-live QuestionOverride wording layered on
// top. Used only when there's no published version to prefer -- this
// keeps wording edits made before versioned publishing existed from being
// silently reverted for every prospect until the first publish. Once a
// version is published, that version wins and this stops being consulted.
//
// Wrapped in its own try/catch so a second table failure here still
// degrades to the untouched factory defaults rather than throwing past
// this helper.
async function factoryWithOverrides(): Promise<Question[]> {
  try {
    const overrides = await db.questionOverride.findMany();
    return withDerivedTiers(
      toStored(mergeQuestions(QUESTIONS, overrides as QuestionOverrideRow[]))
    );
  } catch (e) {
    console.error(
      "Failed to read question overrides while falling back to the factory set; using untouched defaults:",
      e
    );
    return QUESTIONS;
  }
}

// The live assessment reads this. Serves the highest-numbered published
// version, falling back to the factory question set (with any lingering
// override wording applied, see factoryWithOverrides) -- and logging why
// -- on a missing row, a read error, or a stored set that fails
// validation.
export async function getPublishedQuestions(): Promise<{
  questions: Question[];
  version: number | null;
}> {
  try {
    const row = await db.questionSetVersion.findFirst({
      orderBy: { version: "desc" },
    });

    if (!row) {
      return { questions: await factoryWithOverrides(), version: null };
    }

    const questions = resolveQuestions(row.questions);
    if (!questions) {
      console.error(
        "Published question set version %o failed validation; serving the factory questions instead.", row.version
      );
      return { questions: await factoryWithOverrides(), version: null };
    }

    return { questions, version: row.version };
  } catch (e) {
    console.error("Failed to read the published question set, using the factory defaults:", e);
    return { questions: await factoryWithOverrides(), version: null };
  }
}

// Resolves the exact question set a specific published version
// represented, independent of whatever's live right now. /api/submit uses
// this so a submission is scored against what the respondent actually
// loaded, not whatever happens to be live if a publish lands mid-assessment.
//
// version === null means "nothing had been published yet" when the
// respondent loaded the page -- factoryWithOverrides() is safe to
// recompute since nothing writes to QuestionOverride anymore.
//
// Returns null (never throws) when the version can't be resolved. The
// caller should treat that as "can no longer trust what this run scored
// against," not silently fall back to a different question set.
export async function getQuestionsForVersion(
  version: number | null
): Promise<Question[] | null> {
  if (version === null) {
    return factoryWithOverrides();
  }

  try {
    const row = await db.questionSetVersion.findUnique({ where: { version } });
    if (!row) return null;

    const questions = resolveQuestions(row.questions);
    if (!questions) {
      console.error("Question set version %o failed validation.", version);
      return null;
    }
    return questions;
  } catch (e) {
    console.error("Failed to read question set version %o:", version, e);
    return null;
  }
}

// The admin editor reads this. Serves the "draft" row when it exists and
// validates; otherwise falls back to the current published set, then the
// factory default.
//
// `source` disambiguates a null `updatedAt`: it's null both when no draft
// was ever written and when a draft row exists but can't be read. Those
// aren't the same -- the optimistic-concurrency check on the editor's save
// must not silently treat real, unreadable content as absent. `source`
// lets the caller say "your draft couldn't be read, showing the live
// version instead" instead of pretending no draft exists.
export async function getDraftQuestions(): Promise<{
  questions: Question[];
  updatedAt: Date | null;
  source: "draft" | "published" | "factory";
}> {
  try {
    const row = await db.questionDraft.findUnique({ where: { id: "draft" } });
    if (row) {
      const questions = resolveQuestions(row.questions);
      if (questions) {
        return { questions, updatedAt: row.updatedAt, source: "draft" };
      }
      console.error(
        "Draft question set failed validation; falling back to the published set."
      );
      // The row exists but can't be read cleanly -- report source "draft"
      // (updatedAt still null) so the editor can warn "your draft could
      // not be read" instead of treating a corrupt row as if nothing were
      // there to conflict with. Content served is still the safe fallback
      // below.
      const published = await getPublishedQuestions();
      return { questions: published.questions, updatedAt: null, source: "draft" };
    }
  } catch (e) {
    console.error("Failed to read the draft question set, falling back to the published set:", e);
  }

  const published = await getPublishedQuestions();
  return {
    questions: published.questions,
    updatedAt: null,
    source: published.version === null ? "factory" : "published",
  };
}

// The draft's lazy initializer, and the one-time migration off the old
// QuestionOverride table: if a draft row exists and validates, return it.
// Otherwise seed one -- from the highest published version if there is
// one, else from the code defaults merged with any lingering
// QuestionOverride rows -- write it, and return what was written. A
// corrupt row is overwritten rather than just reported, since this
// function is the admin editor's own entry point and is the only tool
// meant to fix it.
//
// Throws rather than degrading, unlike every other exported function
// here: its contract is a real, non-nullable Date, and a fabricated one
// on failure would poison the optimistic-concurrency check that depends
// on it. Callers handle the rejection themselves.
export async function seedDraftQuestions(): Promise<{
  questions: StoredQuestion[];
  updatedAt: Date;
}> {
  const existing = await db.questionDraft.findUnique({ where: { id: "draft" } });
  if (existing) {
    const questions = resolveQuestions(existing.questions);
    if (questions) {
      return { questions: toStored(questions), updatedAt: existing.updatedAt };
    }
    console.error(
      "Draft question set failed validation while seeding; reseeding and overwriting the corrupt row."
    );
  }

  const publishedRow = await db.questionSetVersion.findFirst({
    orderBy: { version: "desc" },
  });

  let seedQuestions: StoredQuestion[];
  if (publishedRow) {
    const resolved = resolveQuestions(publishedRow.questions);
    seedQuestions = resolved ? toStored(resolved) : factoryQuestionSet();
  } else {
    const overrides = await db.questionOverride.findMany();
    seedQuestions = toStored(mergeQuestions(QUESTIONS, overrides as QuestionOverrideRow[]));
  }

  const written = await db.questionDraft.upsert({
    where: { id: "draft" },
    create: { id: "draft", questions: seedQuestions as unknown as Prisma.InputJsonValue },
    update: { questions: seedQuestions as unknown as Prisma.InputJsonValue },
  });

  return { questions: seedQuestions, updatedAt: written.updatedAt };
}
