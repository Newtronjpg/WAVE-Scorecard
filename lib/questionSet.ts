// The stored shape of the question set, and its single validation
// gatekeeper.
//
// Every write path into the question set -- the admin draft save, the
// publish action, and the runtime resolver that serves a prospect -- goes
// through validateQuestionSet. A malformed set that slips past this module
// reaches real users, so this file is pure and defensive: no database, no
// Next.js, no I/O. Given the same input it always produces the same
// verdict.
//
// StoredQuestion is deliberately narrower than Question (lib/questions.ts):
// it has no `tier`, because tier is derived from `value` and the question's
// own choice count (see withDerivedTiers), never stored. Storing a
// computed value invites drift the moment someone edits `levels.length`
// without recomputing tiers by hand.

import { tierForLevel } from "./scoring";
import { GAPS, QUESTIONS, type Gap, type Question } from "./questions";

export const MIN_LEVELS = 2;
export const MAX_LEVELS = 7;
export const MAX_QUESTIONS = 100;

const STATEMENT_MAX = 400;
const LABEL_MAX = 80;
const DESCRIPTION_MAX = 600;

// Ids double as Excel column headers and JSON object keys, so they're
// restricted to a safe identifier shape: a letter, then up to 15 more
// letters/digits/underscore/hyphen.
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;

export const GAP_PREFIX: Record<Gap, string> = {
  wealth: "W",
  accounting: "A",
  value: "V",
  earnings: "E",
};

const VALID_GAPS = new Set<string>(GAPS.map((g) => g.id));

export interface StoredLevel {
  value: number;
  label: string;
  description: string;
}

export interface StoredQuestion {
  id: string;
  gap: Gap;
  statement: string;
  levels: StoredLevel[];
}

export type ValidateResult =
  | { ok: true; questions: StoredQuestion[] }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Validate + normalize a single question. Appends to `errors` and returns
// a best-effort trimmed copy (used only when ok, but built either way so
// callers don't need a second pass).
function validateQuestion(
  raw: unknown,
  index: number,
  errors: string[]
): StoredQuestion | null {
  const label = `Question ${index + 1}`;

  if (!isPlainObject(raw)) {
    errors.push(`${label}: must be an object.`);
    return null;
  }

  // --- shape: id must be present before we can prefix further errors with it
  const rawId = raw.id;
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    errors.push(`${label}: id is required.`);
  }
  const id = typeof rawId === "string" ? rawId.trim() : "";
  const tag = id.length > 0 ? id : label;

  // --- id shape
  if (id.length > 0 && !ID_PATTERN.test(id)) {
    errors.push(
      `${tag}: id "${id}" must start with a letter and contain only letters, digits, "_", or "-" (max 16 characters).`
    );
  }

  // --- gap
  const rawGap = raw.gap;
  let gap: Gap | null = null;
  if (typeof rawGap !== "string" || !VALID_GAPS.has(rawGap)) {
    errors.push(
      `${tag}: gap "${String(rawGap)}" is not one of ${GAPS.map((g) => g.id).join(", ")}.`
    );
  } else {
    gap = rawGap as Gap;
  }

  // --- statement
  const statement = trimmed(raw.statement);
  if (statement.length === 0) {
    errors.push(`${tag}: statement must not be empty.`);
  } else if (statement.length > STATEMENT_MAX) {
    errors.push(
      `${tag}: statement must be at most ${STATEMENT_MAX} characters, got ${statement.length}.`
    );
  }

  // --- levels
  const rawLevels = raw.levels;
  const levels: StoredLevel[] = [];
  if (!Array.isArray(rawLevels)) {
    errors.push(`${tag}: levels must be an array.`);
  } else {
    if (rawLevels.length < MIN_LEVELS || rawLevels.length > MAX_LEVELS) {
      errors.push(
        `${tag}: must have between ${MIN_LEVELS} and ${MAX_LEVELS} choices, got ${rawLevels.length}.`
      );
    }

    const seenValues: number[] = [];
    rawLevels.forEach((rawLevel, levelIndex) => {
      if (!isPlainObject(rawLevel)) {
        errors.push(`${tag}: level ${levelIndex + 1} must be an object.`);
        return;
      }
      const value = rawLevel.value;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(
          `${tag}: level ${levelIndex + 1} value must be a finite number.`
        );
      } else {
        seenValues.push(value);
      }

      const levelLabel = trimmed(rawLevel.label);
      if (levelLabel.length === 0) {
        errors.push(`${tag}: level ${levelIndex + 1} label must not be empty.`);
      } else if (levelLabel.length > LABEL_MAX) {
        errors.push(
          `${tag}: level ${levelIndex + 1} label must be at most ${LABEL_MAX} characters, got ${levelLabel.length}.`
        );
      }

      const levelDescription = trimmed(rawLevel.description);
      if (levelDescription.length === 0) {
        errors.push(
          `${tag}: level ${levelIndex + 1} description must not be empty.`
        );
      } else if (levelDescription.length > DESCRIPTION_MAX) {
        errors.push(
          `${tag}: level ${levelIndex + 1} description must be at most ${DESCRIPTION_MAX} characters, got ${levelDescription.length}.`
        );
      }

      levels.push({
        value: typeof value === "number" ? value : NaN,
        label: levelLabel,
        description: levelDescription,
      });
    });

    // Contiguity: values must be exactly 1..n once sorted, with no NaN.
    // NaN comparisons (`NaN < 1`, `NaN > n`) are both false, so a naive
    // range check would silently let a non-finite value through -- guard
    // against that explicitly rather than relying on the range check below.
    if (rawLevels.length > 0) {
      const hasNonFinite = seenValues.length !== rawLevels.length;
      if (hasNonFinite) {
        // Already reported per-level above.
      } else {
        const sorted = [...seenValues].sort((a, b) => a - b);
        const contiguous = sorted.every((v, i) => v === i + 1);
        if (!contiguous) {
          errors.push(
            `${tag}: level values must be contiguous starting at 1, got ${seenValues.join(", ")}.`
          );
        }
      }
    }
  }

  if (gap === null) {
    return null;
  }

  return { id, gap, statement, levels };
}

/**
 * Validate an unknown value as a question set. Collects every problem
 * found rather than stopping at the first (so an admin UI can show all
 * errors at once), never mutates its input, and returns trimmed text on
 * success.
 */
export function validateQuestionSet(raw: unknown): ValidateResult {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["The question set must be an array of questions."] };
  }

  if (raw.length > MAX_QUESTIONS) {
    errors.push(
      `The question set must have at most ${MAX_QUESTIONS} questions, got ${raw.length}.`
    );
  }

  // Deep-copy up front so nothing downstream can mutate the caller's data,
  // and so validateQuestion's trims never touch the original objects.
  const copy = JSON.parse(JSON.stringify(raw)) as unknown[];

  const questions: StoredQuestion[] = [];
  copy.forEach((rawQuestion, index) => {
    const question = validateQuestion(rawQuestion, index, errors);
    if (question !== null) {
      questions.push(question);
    }
  });

  // Duplicate ids, checked across the whole set.
  const idCounts = new Map<string, number>();
  for (const q of questions) {
    if (q.id.length === 0) continue;
    idCounts.set(q.id, (idCounts.get(q.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push(`Duplicate question id "${id}" appears ${count} times.`);
    }
  }

  // Every gap must have at least one question -- scoreAssessment throws on
  // an empty gap, so a set that passes here must never leave one empty.
  for (const gapMeta of GAPS) {
    const hasQuestion = questions.some((q) => q.gap === gapMeta.id);
    if (!hasQuestion) {
      errors.push(`The ${gapMeta.id} gap has no questions; every gap needs at least one.`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, questions };
}

/**
 * Attach a derived tier to every level, computed from the level's value
 * and that question's own choice count. Tiers are never stored -- they're
 * recomputed here so a question's choice count can change without a
 * separate migration to fix up stale tiers.
 */
export function withDerivedTiers(questions: StoredQuestion[]): Question[] {
  return questions.map((q) => ({
    id: q.id,
    gap: q.gap,
    statement: q.statement,
    levels: q.levels.map((level) => ({
      value: level.value,
      label: level.label,
      description: level.description,
      tier: tierForLevel(level.value, q.levels.length),
    })),
  }));
}

/**
 * The inverse of withDerivedTiers: strip the (derived) tier field back
 * out, producing the shape that gets persisted.
 */
export function toStored(questions: Question[]): StoredQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    gap: q.gap,
    statement: q.statement,
    levels: q.levels.map((level) => ({
      value: level.value,
      label: level.label,
      description: level.description,
    })),
  }));
}

/**
 * The next free id for a new question in `gap`, e.g. "W3" if W1 and W2
 * already exist. Scans every id in the whole set, not just the target
 * gap's, so ids stay globally unique even after a question moves between
 * gaps (an id like "W2" must stay unclaimed even if it now lives under a
 * different gap than its prefix suggests).
 */
export function nextQuestionId(questions: StoredQuestion[], gap: Gap): string {
  const prefix = GAP_PREFIX[gap];
  const usedIds = new Set(questions.map((q) => q.id));
  let n = 1;
  while (usedIds.has(`${prefix}${n}`)) {
    n += 1;
  }
  return `${prefix}${n}`;
}

/**
 * The shipped default question set, in stored form. This is both the seed
 * data for a fresh install and the fallback if a stored set ever fails
 * validation -- so it must always pass validateQuestionSet itself
 * (pinned by a test).
 */
export function factoryQuestionSet(): StoredQuestion[] {
  return toStored(QUESTIONS);
}
