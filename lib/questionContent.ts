import { db } from "./db";
import { QUESTIONS, type Question, type RatingLevel } from "./questions";

// Resolves the question wording shown to a prospect: the defaults in
// lib/questions.ts with any admin edits applied on top.
//
// lib/questions.ts stays the source of truth for STRUCTURE, which
// questions exist, their ids, their gap, the 1-5 scale, and each level's
// tier. The database only ever supplies replacement text. That split is
// what makes editing safe: scoring and the submit route's validator read
// the structural constants directly, so no edit here can change a score,
// invalidate a past submission, or break validation.
//
// The merge is deliberately total. Any override that is unrecognised,
// malformed, or incomplete is ignored in favour of the default rather
// than throwing. One bad row must not be able to take the assessment
// down for every prospect.

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
// rows and returns a new array, leaving its inputs untouched.
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

// Reads the overrides and applies them. Falls back to the untouched
// defaults if the read fails, so a database problem degrades the wording
// rather than breaking the assessment.
export async function getResolvedQuestions(): Promise<Question[]> {
  try {
    const overrides = await db.questionOverride.findMany();
    return mergeQuestions(QUESTIONS, overrides as QuestionOverrideRow[]);
  } catch (e) {
    console.error("Failed to read question overrides, using defaults:", e);
    return QUESTIONS;
  }
}
