import { Assessment } from "@/components/Assessment";
import { Header } from "@/components/Header";
import { getPublishedQuestions } from "@/lib/questionContent";

// Dynamic so that a newly published question set is reflected on the
// next page load rather than being frozen into a build.
export const dynamic = "force-dynamic";

export default async function Home() {
  // version travels with the assessment from here through to /api/submit
  // (see components/Assessment.tsx), so a submission is always scored
  // against the question set this page actually served, even if a publish
  // lands while the prospect is mid-assessment.
  const { questions, version } = await getPublishedQuestions();

  return (
    <main>
      <Header />
      <Assessment questions={questions} version={version} />
    </main>
  );
}
