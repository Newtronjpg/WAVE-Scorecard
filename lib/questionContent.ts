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
// admin UI.
//
// The database now owns the published question set: which questions
// exist, their ids, their gap, how many rating levels each has, and every
// level's label/description/value. lib/questions.ts is no longer the
// runtime source of truth -- it is the factory default, both the seed
// data for a fresh install and the fallback whenever the database is
// unreachable or holds something invalid. Every value read out of the
// database passes through validateQuestionSet (lib/questionSet.ts) before
// it is trusted; nothing here derives tiers from unvalidated input.
//
// The fallback chain is the safety-critical part of this file: a missing
// table, a read error, or an invalid stored set must all degrade to the
// factory questions rather than breaking the assessment for every
// prospect. That is not theoretical -- a missing table caused a real
// production outage here.

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

// The live assessment reads this. Serves the highest-numbered published
// version, falling back to the factory question set -- and logging why --
// on a missing row, a read error, or a stored set that fails validation.
export async function getPublishedQuestions(): Promise<{
  questions: Question[];
  version: number | null;
}> {
  try {
    const row = await db.questionSetVersion.findFirst({
      orderBy: { version: "desc" },
    });

    if (!row) {
      return { questions: QUESTIONS, version: null };
    }

    const questions = resolveQuestions(row.questions);
    if (!questions) {
      console.error(
        `Published question set version ${row.version} failed validation; serving the factory questions instead.`
      );
      return { questions: QUESTIONS, version: null };
    }

    return { questions, version: row.version };
  } catch (e) {
    console.error("Failed to read the published question set, using the factory defaults:", e);
    return { questions: QUESTIONS, version: null };
  }
}

// The admin editor reads this. Serves the "draft" row; if there is none
// yet, falls back to the current published set, then to the factory
// default. updatedAt is null only in that final, no-draft-ever-written
// case.
export async function getDraftQuestions(): Promise<{
  questions: Question[];
  updatedAt: Date | null;
}> {
  try {
    const row = await db.questionDraft.findUnique({ where: { id: "draft" } });
    if (row) {
      const questions = resolveQuestions(row.questions);
      if (questions) {
        return { questions, updatedAt: row.updatedAt };
      }
      console.error(
        "Draft question set failed validation; falling back to the published set."
      );
    }
  } catch (e) {
    console.error("Failed to read the draft question set, falling back to the published set:", e);
  }

  const published = await getPublishedQuestions();
  return { questions: published.questions, updatedAt: null };
}

// The one-time migration off the old QuestionOverride table, and the
// draft's lazy initializer: if a draft row already exists, return it
// as-is. Otherwise seed one -- from the highest published version if
// there is one, or else from the code defaults merged with any lingering
// QuestionOverride rows, so wording edits made before this table existed
// carry forward -- write it, and return what was written.
export async function seedDraftQuestions(): Promise<{
  questions: StoredQuestion[];
  updatedAt: Date;
}> {
  const existing = await db.questionDraft.findUnique({ where: { id: "draft" } });
  if (existing) {
    return {
      questions: existing.questions as unknown as StoredQuestion[],
      updatedAt: existing.updatedAt,
    };
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

// Deprecated: kept only so app/admin/questions/page.tsx keeps compiling
// between this task and Task 7, which rewrites that page against
// getDraftQuestions/getPublishedQuestions directly and deletes this
// alias.
export async function getResolvedQuestions(): Promise<Question[]> {
  return (await getPublishedQuestions()).questions;
}
