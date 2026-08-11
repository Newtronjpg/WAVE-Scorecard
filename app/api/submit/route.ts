import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { scoreAssessment } from "@/lib/scoring";
import { QUESTIONS } from "@/lib/questions";

// Every question id must be present with an integer rating 1-5. Building
// the schema from QUESTIONS (rather than hand-listing 28 keys) means
// adding or removing a question never lets this validator drift out of
// sync with the actual question bank.
const answersShape = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, z.number().int().min(1).max(5)])
);

const submitSchema = z.object({
  answers: z.object(answersShape).strict(),
  prospectName: z.string().trim().min(1).max(200).optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid submission.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { answers, prospectName, companyName } = parsed.data;

  let result;
  try {
    result = scoreAssessment(answers);
  } catch (e) {
    // scoreAssessment only throws for missing/out-of-range answers, both
    // of which the zod schema above should already have caught, so this
    // is a defense-in-depth branch rather than an expected path.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not score assessment." },
      { status: 400 }
    );
  }

  const wealth = result.gaps.find((g) => g.gap === "wealth")!;
  const accounting = result.gaps.find((g) => g.gap === "accounting")!;
  const value = result.gaps.find((g) => g.gap === "value")!;
  const earnings = result.gaps.find((g) => g.gap === "earnings")!;

  try {
    await db.submission.create({
      data: {
        prospectName,
        companyName,
        answers,
        wealthScore: wealth.score,
        accountingScore: accounting.score,
        valueScore: value.score,
        earningsScore: earnings.score,
        overallScore: result.overallScore,
        readinessBand: result.band.label,
      },
    });
  } catch (e) {
    // The person taking the assessment should still see their results
    // even if the save fails; we log server-side so it's not silent, but
    // we don't want a DB hiccup to block someone from seeing a score
    // they just spent five minutes earning.
    console.error("Failed to persist submission:", e);
  }

  return NextResponse.json(result);
}
