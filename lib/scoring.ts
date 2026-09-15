// Scoring logic for the WAVE Scorecard.
//
//   normalized = (rating - 1) / (choiceCount - 1) * 100
//   gapScore   = average of normalized scores for that gap's questions
//   overall    = average of the 4 (rounded) gap scores
//
// Rounding happens at each displayed number, not just at the end -- if
// someone averages the four gap scores on the results page by hand, they
// should land on the same overall number shown, not be off by a fraction.
//
// Zero dependencies on Next.js, Prisma, or the DOM, so this is unit
// tested directly (tests/scoring.test.ts) and reused by /api/submit, the
// results page, and the Excel export without risking drift.

import { GAPS, QUESTIONS, type Gap, type Question, type Tier } from "./questions";

export type AnswerMap = Record<string, number>;

export interface GapResult {
  gap: Gap;
  name: string;
  score: number; // 0-100, rounded
  gapToClose: number; // 100 - score
  // This gap's own band, not the overall one -- a gap sitting at 0 has to
  // read "Poor" even when the overall score lands in "Great".
  band: ReadinessBand;
  // The weakest question in this gap by NORMALIZED score, so questions
  // with different choice counts compare fairly. The results page turns
  // this into the gap's closing sentence.
  lowestQuestionId: string;
  // That question's RAW chosen rating. The workbook picks which closing
  // sentence to use from this (1-2, 3, or 4 -- see buildGapParagraph),
  // which is a different axis from the gap's band, so the raw value has
  // to travel alongside the normalized one.
  lowestRating: number;
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

// The four bands the results page speedometer is divided into: an even
// 25-point slice each, ascending by floor. bandFor picks the last band
// whose floor a score meets, so the floors read as inclusive lower
// bounds -- 24 is Poor, 25 is Fair, 74 is Good, 75 is Great.
//
// Defined in one place so relabeling or re-slicing later is a one-file
// change, not a hunt through the UI. lib/gauge.ts colors the arc by
// INDEX into this array, so reordering these entries reorders the
// colors with them.
// `description` is the top-of-page paragraph shown under the gauge. It sits
// on the same screen as the four per-gap paragraphs in lib/resultsCopy.ts,
// so each one below was checked against that band's four gap paragraphs and
// reworded where a phrase repeated literally. Those rewordings are noted
// inline; the gap paragraphs themselves are verbatim and were left alone.
// Editing either side means re-checking the other.
export const READINESS_BANDS: ReadinessBand[] = [
  {
    label: "Poor",
    floor: 0,
    // Verbatim -- "advantage" also appears in the Poor/Value paragraph, but
    // in a different phrase ("which is the whole advantage"), so there is no
    // literal repetition to remove.
    description:
      "Don’t be alarmed. This is more common than one might think. The good news is that you have identified that you need help accomplishing your goals. The next steps are critical to gain some momentum and start working towards. You have some real work ahead, but with the right partners – we can help you make up meaningful ground in a way that is not overwhelming.",
  },
  {
    label: "Fair",
    floor: 25,
    // Reworded: the source read "The distance between where you are and
    // where you want to land is real — and it is the kind of distance a
    // focused couple of years can close", which restated the Fair/Wealth
    // paragraph's "closing the distance between that thinking and a plan
    // you could act on".
    description:
      "Relax. This is where most owners sit, and it is where starting early pays off the most. What separates where you are from where you want to be is real. The first step is understanding where you are – the next steps are prioritizing what is most important and reasonably able to be accomplished and then assembling a small team to help advance and hold stakeholders accountable.",
  },
  {
    label: "Good",
    floor: 50,
    // Reworded: the source opened "You are closer than most owners", which
    // repeated the Good/Wealth paragraph's "You are further along than most
    // owners" (and Good/Value's "more than most owners can say").
    description:
      "Well done. You are in good shape and ahead of most business owners in your position. Getting to where you are has likely not been easy, and getting over the finish line can often be the hardest task. Often, at this stage – there are certain steps that may require specialized assistance from outside advisors (tax, valuation, succession planning, diligence preparation, legal preparation, etc.). Making sure you have the right team in place to address these areas is critical and helps ensure the momentum you have built can sustain through the finish line.",
  },
  {
    label: "Great",
    floor: 75,
    // Reworded: the source read "protecting the value you have built",
    // the duplicate the copy doc flagged against the Great/Wealth
    // paragraph's "protecting what you have built".
    description:
      "Congratulations. You are in better shape than most across each gap area. The real work now is defending this position and staying ready for what lies ahead. While you can breathe easier than most – now is not the time to let up. Often, business owners face unexpected changes at the ninth hour. The good news is that you are in a good position to navigate this or see this through before the unexpected happens. If you haven’t already – make sure you have the right support around you to maintain your position and see this through.",
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

// Tier derives from the level's position among choiceCount options, spread
// evenly across the four tier names, rather than fixed 25/50/75 cutoffs on
// the normalized score. Fixed cutoffs read cleanly at five choices but the
// top two collide into the same label at 5, 9, 13... choices, which reads
// as a bug once an admin can see every level's tier side by side.
//
// Deliberately not shared with lib/questions.ts's own tierFor, which stays
// on the original fixed mapping that tests/scoring.test.ts pins for the
// factory data and must never change -- safe to leave alone, since nothing
// reads a stored tier field; this function is called fresh on every render.
export function tierForLevel(value: number, choiceCount: number): Tier {
  // Reuses normalizeAnswer purely for its validation; tier comes from
  // position, not the normalized score.
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

    // Strict `<` is what implements the tie-break: on equal scores the
    // earlier entry is never displaced, so the winner is the first
    // question in the supplied array order -- the same order
    // components/Assessment.tsx renders in, which is the order the admin
    // arranged in /admin/questions. Sorting by id or by gap would answer
    // differently and be wrong.
    let lowestIndex = 0;
    for (let i = 1; i < normalizedScores.length; i++) {
      if (normalizedScores[i] < normalizedScores[lowestIndex]) lowestIndex = i;
    }

    return {
      gap: gapMeta.id,
      name: gapMeta.name,
      score,
      gapToClose: 100 - score,
      band: bandFor(score),
      lowestQuestionId: gapQuestions[lowestIndex].id,
      lowestRating: answers[gapQuestions[lowestIndex].id],
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
