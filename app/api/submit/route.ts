import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scoreAssessment } from "@/lib/scoring";
import { getPublishedQuestions, getQuestionsForVersion } from "@/lib/questionContent";
import { toStored } from "@/lib/questionSet";
import type { Question } from "@/lib/questions";
import { getNotifyRecipients } from "@/lib/settings";
import { checkRateLimit, clientIdentifier } from "@/lib/rateLimit";
import {
  resolveAdminUrl,
  sendPersistenceFailureAlert,
  sendSubmissionNotification,
} from "@/lib/email";

export async function POST(req: NextRequest) {
  // Throttle before doing any work. This endpoint is public and every
  // accepted call writes a row and sends an email, so it is the one place
  // an unauthenticated visitor can cost us real resources.
  const limit = await checkRateLimit(clientIdentifier(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many submissions from this connection. Please try again later.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // The respondent's browser carries the question-set version it loaded at
  // the START of the assessment (app/page.tsx resolves {questions, version}
  // once and threads version through components/Assessment.tsx untouched
  // to this request). That matters because a publish can land while
  // someone is mid-assessment: the set live RIGHT NOW is not necessarily
  // the set they answered. When a version travels with the request, we
  // resolve that EXACT historical snapshot via getQuestionsForVersion --
  // QuestionSetVersion rows are append-only and immutable (see
  // prisma/schema.prisma), so the lookup is always reproducible -- instead
  // of asking getPublishedQuestions what's live now. Only fall back to the
  // live published set when the request carries no version at all (an
  // older cached client bundle, or a non-browser caller); that fallback is
  // also what keeps the pre-versioning behavior working unchanged.
  const bodyRecord: Record<string, unknown> =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rawVersion = bodyRecord.questionSetVersion;
  const requestedVersion: number | null | undefined =
    rawVersion === null || typeof rawVersion === "number" ? rawVersion : undefined;

  let questions: Question[];
  let version: number | null;
  if (requestedVersion !== undefined) {
    let resolved = await getQuestionsForVersion(requestedVersion);
    if (!resolved) {
      // getQuestionsForVersion swallows read errors into a null return
      // (see its own try/catch in lib/questionContent.ts) alongside a
      // genuinely missing/corrupt row, so a single null here could just
      // be a transient blip -- a connection-pool timeout, a cold start --
      // rather than something permanently unresolvable. One retry costs
      // a single extra round trip and closes that common case for free
      // before we give up on an otherwise-complete assessment.
      resolved = await getQuestionsForVersion(requestedVersion);
    }
    if (!resolved) {
      // Still unresolvable after a retry: there is nothing safe to
      // validate, score, or snapshot the run against, so we do not write
      // a Submission row for it. But per review finding C1, that must
      // never mean the respondent's answers are silently thrown away --
      // db.submission.create's own catch block below exists precisely
      // because a swallowed failure here once lost every hosted
      // submission for a day. Mirror that remedy exactly: alert staff
      // with the raw answers, since this response is the only place
      // that data still exists. Extracted straight from the raw body
      // (not the zod-validated `answers` below) because that schema is
      // built from `questions`, which we don't have on this path.
      const rawAnswers = bodyRecord.answers;
      const answersForAlert: Record<string, number> =
        rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)
          ? Object.fromEntries(
              Object.entries(rawAnswers as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number"
              )
            )
          : {};
      const prospectNameForAlert =
        typeof bodyRecord.prospectName === "string" ? bodyRecord.prospectName : "";
      const companyNameForAlert =
        typeof bodyRecord.companyName === "string" ? bodyRecord.companyName : "";

      const reason = `Could not resolve question set version ${requestedVersion} after a retry.`;
      console.error(reason);

      // Review finding I-2: this branch runs before the zod parse below
      // (that schema needs `questions`, which this path never obtained),
      // so without a check here a request that was never a genuine
      // attempt -- no answers at all, a fractional "version" like 3.5
      // that could never match a real row -- would still page staff with
      // an "ACTION NEEDED" alert about nothing. Screening on shape alone
      // (not full validation, which still happens later for anything
      // that reaches it) keeps the alert meaning what its subject line
      // claims: a real assessment that really could not be saved.
      const looksLikeARealAttempt =
        Object.keys(answersForAlert).length > 0 &&
        prospectNameForAlert.trim().length > 0 &&
        companyNameForAlert.trim().length > 0 &&
        (requestedVersion === null || Number.isInteger(requestedVersion));

      if (looksLikeARealAttempt) {
        const adminUrl = resolveAdminUrl(req.nextUrl.origin);
        const recipients = await getNotifyRecipients();
        try {
          await sendPersistenceFailureAlert({
            prospectName: prospectNameForAlert,
            companyName: companyNameForAlert,
            recipients,
            answers: answersForAlert,
            // No score exists on this path -- nothing was resolved to
            // score against, so `result` is correctly omitted rather than
            // fabricated (see PersistenceFailureDetails.result, now
            // optional for exactly this case).
            adminUrl,
            error: new Error(reason),
          });
        } catch (alertError) {
          // sendPersistenceFailureAlert is written not to throw, so
          // reaching here means something unforeseen. Never let it mask
          // the original resolution failure or break the response.
          console.error("Failed to raise persistence failure alert:", alertError);
        }
      }

      // 503, not 409: this is not a conflict between the request and
      // server state (409's usual meaning) -- it's our own dependency,
      // the question-set store, that could not be read twice in a row.
      // That is squarely "the server is temporarily unable to handle
      // the request" territory, and 503 correctly signals to a
      // programmatic caller that retrying shortly is reasonable, where
      // 409 would incorrectly suggest the request itself needs to
      // change before it can succeed.
      return NextResponse.json(
        {
          error:
            "We couldn't record your results just now. Your answers have not been lost -- please try submitting again in a moment.",
        },
        { status: 503 }
      );
    }
    questions = resolved;
    version = requestedVersion;
  } else {
    const published = await getPublishedQuestions();
    questions = published.questions;
    version = published.version;
  }

  // Built per request from the RESOLVED set -- the version the respondent
  // actually answered -- so the bound on each answer is that question's
  // own choice count. Deriving it here rather than hand-listing keys is
  // what keeps the validator from drifting out of sync when a question is
  // added or removed.
  const answersShape = Object.fromEntries(
    questions.map((q) => [q.id, z.number().int().min(1).max(q.levels.length)])
  );
  const submitSchema = z.object({
    answers: z.object(answersShape).strict(),
    // Required, not optional: the intro form now requires both before the
    // assessment can start, so the API enforces the same rule server-side
    // rather than trusting the client not to skip it.
    prospectName: z.string().trim().min(1, "Name is required.").max(200),
    companyName: z.string().trim().min(1, "Company is required.").max(200),
    // Optional so an older cached client bundle that doesn't send it still
    // works via the live-published fallback above.
    questionSetVersion: z.number().int().nullable().optional(),
  });

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
    result = scoreAssessment(answers, questions);
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

  const adminUrl = resolveAdminUrl(req.nextUrl.origin);
  // Resolved once, before the write, so the failure alert can still reach
  // someone when the write is what failed. getNotifyRecipients falls back
  // to NOTIFY_EMAIL if the settings read itself fails.
  const recipients = await getNotifyRecipients();
  let saved = true;
  let notification: { sent: boolean; reason?: string } = {
    sent: false,
    reason: "not attempted",
  };

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
        // Which published question set this run answered, resolved above
        // so it's always the version the respondent actually loaded, not
        // whatever is live at the instant of this write. Null means the
        // factory default, including every run before versioning existed.
        questionSetVersion: version,
        // The literal question set `questions` (above) was scored
        // against -- id, gap, statement, levels -- so this row is
        // self-describing even if the QuestionSetVersion it names is
        // ever unreadable. See prisma/schema.prisma for the full
        // rationale (Task 5 review I2).
        questionSetSnapshot: toStored(questions) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // The person taking the assessment should still see their results
    // even if the save fails; a DB hiccup must not block someone from
    // seeing a score they just spent five minutes earning.
    //
    // But a swallowed failure here once lost every hosted submission for
    // a day, because the response was indistinguishable from a success
    // and nobody was told. So the failure now travels two ways: `saved`
    // goes back to the client, and an alert goes to staff carrying the
    // raw answers, since this response is the only place that data still
    // exists.
    saved = false;
    console.error("Failed to persist submission:", e);

    try {
      await sendPersistenceFailureAlert({
        prospectName,
        companyName,
        recipients,
        answers,
        result,
        adminUrl,
        error: e,
      });
    } catch (alertError) {
      // sendPersistenceFailureAlert is written not to throw, so reaching
      // here means something unforeseen. Never let it mask the original
      // data loss or break the response.
      console.error("Failed to raise persistence failure alert:", alertError);
    }
  }

  // Only for submissions that actually landed. Sending the routine "new
  // submission" email after a failed write would tell staff a submission
  // is waiting in the admin table when it is not there at all; the
  // failure alert above is what gets sent instead.
  //
  // Awaited on purpose: a serverless function can be frozen or torn down
  // the moment the response is sent, so an un-awaited "fire and forget"
  // email risks never actually going out. sendSubmissionNotification
  // itself never throws (see lib/email.ts), so this can't fail the
  // response, it can only add a little latency while it sends.
  if (saved) {
    notification = await sendSubmissionNotification({
      prospectName,
      companyName,
      result,
      adminUrl,
      recipients,
    });
    if (!notification.sent) {
      console.log("Submission notification not sent:", notification.reason);
    }
  }

  // _notification only appears outside production (NODE_ENV is set
  // automatically by `next dev`/`next start`, nothing to configure). It
  // exists so the email outcome shows up directly in whatever terminal
  // is testing /api/submit, curl's own stdout included, instead of
  // needing to go find it in a separate server log window. On the real
  // deploy this field never appears at all, so it can't leak mail
  // error text or delivery status to an actual client.
  // `saved` ships in production too, unlike _notification. The client
  // needs it to tell the person their results were not recorded; without
  // it a lost submission looks exactly like a successful one.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ...result, saved });
  }
  return NextResponse.json({ ...result, saved, _notification: notification });
}
