import { Assessment } from "@/components/Assessment";
import { Header } from "@/components/Header";
import { getResolvedQuestions } from "@/lib/questionContent";

// Dynamic so that wording edited in /admin/questions is reflected on the
// next page load rather than being frozen into a build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const questions = await getResolvedQuestions();

  return (
    <main>
      <Header />
      <Assessment questions={questions} />
    </main>
  );
}
