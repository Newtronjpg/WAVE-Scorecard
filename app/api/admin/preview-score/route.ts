import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { scoreAssessment } from "@/lib/scoring";
import { getDraftQuestions } from "@/lib/questionContent";

// Scores against the DRAFT so a question set can be tested before it goes
// live. It deliberately shares no code path with /api/submit beyond
// scoreAssessment: no row is written, no email is sent, no rate limit is
// consumed. If this ever starts persisting anything, that is a bug.
//
// Reachable only through proxy.ts's existing /api/admin/* gate, so it
// carries no auth of its own.

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // getDraftQuestions never throws by contract, but this is defense in
  // depth against that changing -- an admin testing a draft should see a
  // readable 400, never an unhandled 500.
  let questions;
  try {
    const draft = await getDraftQuestions();
    questions = draft.questions;
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Could not read the draft question set.",
      },
      { status: 400 }
    );
  }

  // Same derivation as /api/submit: the bound is each question's own
  // choice count, not a hardcoded 5, so this stays honest even for a
  // draft question that hasn't been published with its new choice count.
  const answersShape = Object.fromEntries(
    questions.map((q) => [q.id, z.number().int().min(1).max(q.levels.length)])
  );
  const previewSchema = z.object({
    answers: z.object(answersShape).strict(),
  });

  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid answers.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = scoreAssessment(parsed.data.answers, questions);
    return NextResponse.json({ ...result, preview: true });
  } catch (e) {
    // scoreAssessment only throws for missing/out-of-range answers, both
    // of which the zod schema above should already have caught -- defense
    // in depth, not an expected path.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not score assessment." },
      { status: 400 }
    );
  }
}
