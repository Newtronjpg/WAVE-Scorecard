import { GAPS } from "@/lib/questions";
import { normalizeAnswer } from "@/lib/scoring";
import type { StoredQuestion } from "@/lib/questionSet";

// An automatic sanity check on the draft's scoring math. Silent when
// everything checks out; speaks up by question id only when it finds
// rating values that aren't 1..n in order (most likely a hand-edited row)
// -- a narrower, earlier check than validateQuestionSet for the one class
// of error that wouldn't otherwise be visible until a score came back wrong.

function findMisconfigured(questions: StoredQuestion[]): string[] {
  const bad: string[] = [];
  for (const q of questions) {
    const values = q.levels.map((l) => l.value);
    const expected = values.map((_, i) => i + 1);
    const isContiguous = values.every((v, i) => v === expected[i]);
    if (!isContiguous) bad.push(q.id);
  }
  return bad;
}

// Backstop: with contiguous values this can never actually fire (rating 1
// always normalizes to 0, rating n always normalizes to 100), but if it
// somehow did, that's real enough to say something about even without a
// specific question to name.
function aggregateLooksWrong(questions: StoredQuestion[]): boolean {
  for (const gapMeta of GAPS) {
    const gapQuestions = questions.filter((q) => q.gap === gapMeta.id);
    if (gapQuestions.length === 0) continue;
    const lowest = gapQuestions.map((q) => normalizeAnswer(1, q.levels.length));
    const highest = gapQuestions.map((q) =>
      normalizeAnswer(q.levels.length, q.levels.length)
    );
    if (lowest.some((n) => n !== 0) || highest.some((n) => n !== 100)) return true;
  }
  return false;
}

export function ScoringCheck({ questions }: { questions: StoredQuestion[] }) {
  const misconfigured = findMisconfigured(questions);
  if (misconfigured.length === 0 && !aggregateLooksWrong(questions)) {
    return null;
  }

  return (
    <div
      role="alert"
      className="mt-4 rounded-md border border-maroon bg-[var(--color-maroon)]/5 p-3 text-sm text-ink"
    >
      <p className="font-medium text-maroon">Scoring problem detected</p>
      {misconfigured.length > 0 ? (
        <p className="mt-1 text-ink-muted">
          {misconfigured.join(", ")} {misconfigured.length === 1 ? "has" : "have"}{" "}
          rating values out of order, so answers to{" "}
          {misconfigured.length === 1 ? "it" : "them"} won&rsquo;t score
          correctly. Remove and re-add a choice on{" "}
          {misconfigured.length === 1 ? "that question" : "those questions"} to
          fix it.
        </p>
      ) : (
        <p className="mt-1 text-ink-muted">
          The scoring math for this draft isn&rsquo;t coming out right. Check
          each question&rsquo;s choices for anything unusual before publishing.
        </p>
      )}
    </div>
  );
}
