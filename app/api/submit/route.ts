import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { scoreAssessment } from "@/lib/scoring";
import { QUESTIONS } from "@/lib/questions";
import { sendSubmissionNotification } from "@/lib/email";

// Every question id must be present with an integer rating 1-5. Building
// the schema from QUESTIONS (rather than hand-listing 28 keys) means
// adding or removing a question never lets this validator drift out of
// sync with the actual question bank.
const answersShape = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, z.number().int().min(1).max(5)])
);

const submitSchema = z.object({
  answers: z.object(answersShape).strict(),
  // Required, not optional: the intro form now requires both before the
  // assessment can start, so the API enforces the same rule server-side
  // rather than trusting the client not to skip it.
  prospectName: z.string().trim().min(1, "Name is required.").max(200),
  companyName: z.string().trim().min(1, "Company is required.").max(200),
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

  // Awaited on purpose: a serverless function can be frozen or torn down
  // the moment the response is sent, so an un-awaited "fire and forget"
  // email risks never actually going out. sendSubmissionNotification
  // itself never throws (see lib/email.ts), so this can't fail the
  // response, it can only add a little latency while it sends.
  const notification = await sendSubmissionNotification({
    prospectName,
    companyName,
    result,
    adminUrl: new URL("/admin", req.nextUrl.origin).toString(),
  });
  if (!notification.sent) {
    console.log("Submission notification not sent:", notification.reason);
  }

  // _notification only appears outside production (NODE_ENV is set
  // automatically by `next dev`/`next start`, nothing to configure). It
  // exists so the email outcome shows up directly in whatever terminal
  // is testing /api/submit, curl's own stdout included, instead of
  // needing to go find it in a separate server log window. On the real
  // deploy this field never appears at all, so it can't leak Resend
  // error text or delivery status to an actual client.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(result);
  }
  return NextResponse.json({ ...result, _notification: notification });
}
