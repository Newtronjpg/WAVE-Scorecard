import Link from "next/link";
import { db } from "@/lib/db";
import { GAPS } from "@/lib/questions";
import { getResolvedQuestions } from "@/lib/questionContent";
import { QuestionEditor } from "@/components/QuestionEditor";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const questions = await getResolvedQuestions();

  // Which questions currently carry an override, so the UI can mark them
  // and offer "reset to original" only where there is something to reset.
  let editedIds = new Set<string>();
  try {
    const overrides = await db.questionOverride.findMany({
      select: { questionId: true },
    });
    editedIds = new Set(overrides.map((o) => o.questionId));
  } catch {
    // Non-fatal: the editor still works, it just cannot show the badge.
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
        &larr; Back to submissions
      </Link>

      <h1 className="font-display text-3xl text-ink mt-3">Questions</h1>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed max-w-xl">
        Edit the wording of any question and what each rating from 1 to 5
        means. Changes appear on the assessment immediately. Scores are
        unaffected: the four gaps, the seven questions in each, and the 1&ndash;5
        scale are fixed, so past submissions stay valid.
      </p>

      {GAPS.map((gap) => (
        <section key={gap.id} className="mt-10">
          <h2 className="font-display text-xl text-maroon">{gap.name}</h2>
          <p className="mt-1 text-sm text-ink-muted">{gap.tagline}</p>

          <div className="mt-4 border-t border-line">
            {questions
              .filter((q) => q.gap === gap.id)
              .map((question) => (
                <QuestionEditor
                  key={question.id}
                  question={question}
                  edited={editedIds.has(question.id)}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
