import Link from "next/link";
import { seedDraftQuestions, getPublishedQuestions } from "@/lib/questionContent";
import { QuestionSetEditor } from "@/components/QuestionSetEditor";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  // seedDraftQuestions writes (creating or repairing the draft row as
  // needed) and throws on failure by design -- there is no honest
  // fallback value for a page whose whole job is editing that row, so a
  // database failure here surfaces as a real error rather than silently
  // handing the admin a draft that doesn't match what's actually stored.
  const [{ questions, updatedAt }, published] = await Promise.all([
    seedDraftQuestions(),
    getPublishedQuestions(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
        &larr; Back to submissions
      </Link>

      <h1 className="font-display text-3xl text-ink mt-3">Questions</h1>
      <p className="mt-2 text-sm text-ink-muted leading-relaxed max-w-xl">
        Add, remove, and reword questions, and set how many answer choices each
        one has. Nothing here reaches the live assessment until you press
        Publish. Past submissions keep the scores they were given.
      </p>

      <QuestionSetEditor
        initialQuestions={questions}
        initialUpdatedAt={updatedAt.toISOString()}
        publishedVersion={published.version}
      />
    </div>
  );
}
