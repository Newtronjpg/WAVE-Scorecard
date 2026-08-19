import { Assessment } from "@/components/Assessment";
import { Header } from "@/components/Header";
import { getDraftQuestions } from "@/lib/questionContent";

// Dynamic so a change just saved in the editor shows up on the very next
// load, never a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function PreviewPage() {
  const { questions } = await getDraftQuestions();

  return (
    <main>
      <div
        role="status"
        className="bg-maroon px-5 py-2 text-center text-sm text-white"
      >
        Preview of the draft question set. Nothing here is saved and no
        email is sent.
      </div>
      <Header />
      {/* version is always null here: previews score against the draft,
          which has no version number, and /api/admin/preview-score
          ignores whatever this sends anyway -- it always reads the
          draft directly. */}
      <Assessment
        questions={questions}
        version={null}
        submitPath="/api/admin/preview-score"
      />
    </main>
  );
}
