import { GAPS, type Gap } from "@/lib/questions";
import { normalizeAnswer } from "@/lib/scoring";
import type { StoredQuestion } from "@/lib/questionSet";

// A live, local scoring sanity check for the draft -- computed exactly the
// way scoreAssessment computes a real submission (normalize per question,
// round per gap, then round the overall average of the four gap scores),
// so this panel can never disagree with what a real score would say. Lets
// an admin catch a misconfigured question (a lopsided choice count, a
// level added with the wrong effective position) before publishing,
// without leaving the editor to run a full preview.
//
// No hooks, no interactivity -- purely derived from the `questions` prop
// on every render, same as GapScoreBar.

type Pick = (question: StoredQuestion) => number;

const lowestPick: Pick = () => 1;
const highestPick: Pick = (q) => q.levels.length;
// There is no exact middle choice when the count is even. Nearest integer
// to the midpoint is close enough for a sanity check -- this row is never
// claimed to be an achievable score, just a rough midpoint reference.
const middlePick: Pick = (q) => Math.round((1 + q.levels.length) / 2);

// Mirrors scoreAssessment's rounding exactly: round each gap average, then
// round the average of the (already-rounded) gap scores. Returns null if
// any gap currently has zero questions -- that is an invalid set
// (scoreAssessment itself would throw), which can happen transiently while
// editing, before the problem list catches it.
function overallFor(questions: StoredQuestion[], pick: Pick): number | null {
  const gapScores: number[] = [];
  for (const gapMeta of GAPS) {
    const gapQuestions = questions.filter((q) => q.gap === gapMeta.id);
    if (gapQuestions.length === 0) return null;
    const norms = gapQuestions.map((q) =>
      normalizeAnswer(pick(q), q.levels.length)
    );
    const avg = norms.reduce((sum, n) => sum + n, 0) / norms.length;
    gapScores.push(Math.round(avg));
  }
  return Math.round(gapScores.reduce((sum, n) => sum + n, 0) / gapScores.length);
}

export function ScoringCheck({ questions }: { questions: StoredQuestion[] }) {
  const counts: Record<Gap, number> = {
    wealth: 0,
    accounting: 0,
    value: 0,
    earnings: 0,
  };
  for (const q of questions) {
    counts[q.gap] += 1;
  }

  const lowest = overallFor(questions, lowestPick);
  const middle = overallFor(questions, middlePick);
  const highest = overallFor(questions, highestPick);

  return (
    <div className="mt-6 rounded-md border border-line p-4">
      <p className="text-xs font-medium tracking-wide uppercase text-ink-muted">
        Scoring check
      </p>

      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        {GAPS.map((gapMeta) => (
          <div key={gapMeta.id}>
            <span className="block font-display text-lg text-maroon">
              {counts[gapMeta.id]}
            </span>
            <span className="text-xs text-ink-muted">{gapMeta.name}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        <ScoreStat label="All lowest" value={lowest} expected={0} />
        <ScoreStat label="All middle" value={middle} />
        <ScoreStat label="All highest" value={highest} expected={100} />
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        Lowest should always be 0 and highest always 100. Anything else means
        a question is misconfigured.
      </p>
    </div>
  );
}

function ScoreStat({
  label,
  value,
  expected,
}: {
  label: string;
  value: number | null;
  expected?: number;
}) {
  const mismatch = expected !== undefined && value !== null && value !== expected;
  return (
    <div>
      <span
        className={
          mismatch
            ? "block font-display text-lg text-red"
            : "block font-display text-lg text-ink"
        }
      >
        {value === null ? "—" : value}
      </span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}
