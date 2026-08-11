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

import { GAPS, QUESTIONS, type Gap } from "./questions";

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
// evenly-spaced extrapolation from that single data point. Ben should
// treat the exact cutoffs and names as a first draft, not gospel; they're
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

export function normalizeAnswer(rating: number): number {
  if (rating < 1 || rating > 5) {
    throw new Error(`Rating must be between 1 and 5, got ${rating}`);
  }
  return ((rating - 1) / 4) * 100;
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

function assertComplete(answers: AnswerMap): void {
  const missing = QUESTIONS.filter((q) => answers[q.id] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing answers for: ${missing.map((q) => q.id).join(", ")}`
    );
  }
}

export function scoreAssessment(answers: AnswerMap): ScoreResult {
  assertComplete(answers);

  const gapResults: GapResult[] = GAPS.map((gapMeta) => {
    const gapQuestions = QUESTIONS.filter((q) => q.gap === gapMeta.id);
    const normalizedScores = gapQuestions.map((q) =>
      normalizeAnswer(answers[q.id])
    );
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

// Same tier system Ben's Excel workbook already uses in the Action Library
// and Combo Rules ("W1 is Good/Excellent AND W3 is Poor/Fair"). Keeping
// this in one function means the rubric UI, the results page, and any
// future rules engine all agree on what "Poor" means for a given answer.
export function tierForRating(rating: number): "Poor" | "Fair" | "Good" | "Excellent" {
  if (rating <= 1) return "Poor";
  if (rating === 2) return "Fair";
  if (rating === 3) return "Good";
  return "Excellent";
}
