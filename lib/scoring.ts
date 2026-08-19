// Scoring logic for the WAVE Scorecard.
//
// This preserves the exact formula reverse-engineered from the existing
// HTML prototype (verified against its worked example: Wealth 50,
// Accounting 75, Value 50, Earnings 57 -> overall 58):
//
//   normalized = (rating - 1) / 4 * 100        (1 -> 0, 5 -> 100)
//   gapScore   = average of normalized scores for that gap's 7 questions
//   overall    = average of the 4 (rounded) gap scores
//
// Rounding happens at each displayed number (gap scores, then overall),
// not just at the end. That's deliberate: if someone looks at the four
// gap scores on the results page and averages them by hand, they should
// land on the same overall number we show, not be off by a fraction from
// unrounded intermediate math.
//
// This module has zero dependencies on Next.js, Prisma, or the DOM, so it
// can be unit tested directly (see tests/scoring.test.ts) and reused by
// the /api/submit route, the results page, and the Excel export without
// three different copies of the math ever drifting apart.

import { GAPS, QUESTIONS, type Gap, type Question, type Tier } from "./questions";

export type AnswerMap = Record<string, number>;

export interface GapResult {
  gap: Gap;
  name: string;
  score: number; // 0-100, rounded
  gapToClose: number; // 100 - score
}

export interface ReadinessBand {
  label: string;
  floor: number;
  description: string;
}

export interface ScoreResult {
  overallScore: number;
  band: ReadinessBand;
  gaps: GapResult[];
  widestGap: GapResult;
}

// Only one example of the current band scheme survived in the source
// material (58 -> "Meaningful gaps"). These boundaries are a reasonable,
// evenly-spaced extrapolation from that single data point. Treat the
// exact cutoffs and names as a first draft, not gospel; they're
// defined in one place here so relabeling or re-slicing later is a
// one-file change, not a hunt through the UI.
export const READINESS_BANDS: ReadinessBand[] = [
  {
    label: "Significant gaps",
    floor: 0,
    description:
      "There's foundational work to do across most of these areas before a transaction conversation makes sense.",
  },
  {
    label: "Meaningful gaps",
    floor: 40,
    description:
      "This is where most owners sit, and where starting three to seven years early pays off the most. There is real, fixable work between you and your number.",
  },
  {
    label: "Minor gaps",
    floor: 60,
    description:
      "The fundamentals are largely in place. What's left is closing specific, identifiable gaps rather than starting from scratch.",
  },
  {
    label: "Transaction ready",
    floor: 80,
    description:
      "The business is in strong position for a transaction conversation whenever you're ready to have it.",
  },
];

// The denominator is the choice count minus one, not the constant 4.
// It defaults to 5 so the original single-argument call still works and
// produces identical numbers -- that equivalence is what keeps the pinned
// worked example in tests/scoring.test.ts valid across this change.
export function normalizeAnswer(rating: number, choiceCount: number = 5): number {
  if (choiceCount < 2) {
    throw new Error(`A question needs at least 2 choices, got ${choiceCount}`);
  }
  if (rating < 1 || rating > choiceCount) {
    throw new Error(`Rating must be between 1 and ${choiceCount}, got ${rating}`);
  }
  return ((rating - 1) / (choiceCount - 1)) * 100;
}

// Tier derives from the level's POSITION among choiceCount options, spread
// as evenly as possible across the four tier names, rather than from fixed
// 25/50/75 cutoffs on the normalized score. Fixed cutoffs read cleanly at
// five choices (0/25/50/75/100 lines up 1=Poor 2=Fair 3=Good 4=Excellent
// 5=Excellent) but the last two collide into the same label -- a quartile
// boundary landing exactly on a level, which happens at 5, 9, 13... choices
// and reads as a bug once an admin can see every level's tier side by side.
// Even distribution guarantees no more than one tier ever absorbs an extra
// level, and always anchors the bottom choice at Poor and the top choice at
// Excellent for any choiceCount of 4 or more.
export function tierForLevel(value: number, choiceCount: number): Tier {
  // Reuses normalizeAnswer purely for its validation (throws on an
  // out-of-range choiceCount or value); the tier itself comes from
  // position, not the normalized score.
  //
  // This is intentionally NOT shared with lib/questions.ts's own tierFor,
  // which stays on the original fixed 1=Poor 2=Fair 3=Good 4-5=Excellent
  // map -- tests/scoring.test.ts pins that exact mapping for the factory
  // question bank's literal data and must never be edited. That's safe to
  // leave alone: QuestionRow.tsx (and withDerivedTiers) never read a
  // stored tier field, they call this function fresh on every render, so
  // the admin editor always reflects the distribution below regardless of
  // what's baked into the factory data.
  normalizeAnswer(value, choiceCount);
  const tiers: Tier[] = ["Poor", "Fair", "Good", "Excellent"];
  const bucket = Math.floor(((value - 1) * tiers.length) / choiceCount);
  return tiers[Math.min(bucket, tiers.length - 1)];
}

export function bandFor(score: number): ReadinessBand {
  // READINESS_BANDS is ascending by floor, so the last one whose floor the
  // score meets or exceeds is correct.
  let match = READINESS_BANDS[0];
  for (const band of READINESS_BANDS) {
    if (score >= band.floor) match = band;
  }
  return match;
}

function assertComplete(answers: AnswerMap, questions: Question[]): void {
  const missing = questions.filter((q) => answers[q.id] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing answers for: ${missing.map((q) => q.id).join(", ")}`
    );
  }
}

export function scoreAssessment(
  answers: AnswerMap,
  questions: Question[] = QUESTIONS
): ScoreResult {
  assertComplete(answers, questions);

  const gapResults: GapResult[] = GAPS.map((gapMeta) => {
    const gapQuestions = questions.filter((q) => q.gap === gapMeta.id);
    if (gapQuestions.length === 0) {
      // Previously this divided by zero and produced NaN, which would then
      // be written into an Int column. Fail loudly instead.
      throw new Error(
        `The ${gapMeta.id} gap has no questions; every gap needs at least one.`
      );
    }
    const normalizedScores = gapQuestions.map((q) => {
      try {
        return normalizeAnswer(answers[q.id], q.levels.length);
      } catch (err) {
        // normalizeAnswer doesn't know which question it's scoring, so it
        // can't say. This is user-facing (app/api/submit/route.ts returns
        // the message verbatim), so name the question here where q.id is
        // in hand, and keep the original detail rather than replacing it.
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Question ${q.id}: ${detail}`);
      }
    });
    const rawAverage =
      normalizedScores.reduce((sum, n) => sum + n, 0) / normalizedScores.length;
    const score = Math.round(rawAverage);
    return {
      gap: gapMeta.id,
      name: gapMeta.name,
      score,
      gapToClose: 100 - score,
    };
  });

  const overallScore = Math.round(
    gapResults.reduce((sum, g) => sum + g.score, 0) / gapResults.length
  );

  const widestGap = gapResults.reduce((worst, g) =>
    g.score < worst.score ? g : worst
  );

  return {
    overallScore,
    band: bandFor(overallScore),
    gaps: gapResults,
    widestGap,
  };
}

// Same tier system the source Excel workbook already uses in the Action
// Library and Combo Rules ("W1 is Good/Excellent AND W3 is Poor/Fair"). Keeping
// this in one function means the rubric UI, the results page, and any
// future rules engine all agree on what "Poor" means for a given answer.
/**
 * @deprecated Five-choice questions only. It takes no choice count, so it
 * cannot describe a 3- or 7-choice question. Use tierForLevel(value, count).
 * Retained because tests/scoring.test.ts pins it as a regression gate.
 */
export function tierForRating(rating: number): "Poor" | "Fair" | "Good" | "Excellent" {
  if (rating <= 1) return "Poor";
  if (rating === 2) return "Fair";
  if (rating === 3) return "Good";
  return "Excellent";
}
