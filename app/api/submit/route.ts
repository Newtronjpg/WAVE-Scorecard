import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scoreAssessment } from "@/lib/scoring";
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_PAYLOAD_LENGTH,
  normalizeComments,
} from "@/lib/comments";
import {
  MAX_EMAIL_LENGTH,
  MAX_INDUSTRY_LENGTH,
  isPlausibleEmail,
  isValidIndustry,
} from "@/lib/contact";
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
  // the start of the assessment. A publish can land mid-assessment, so
  // what's live right now isn't necessarily what they answered -- resolve
  // that exact historical snapshot via getQuestionsForVersion instead of
  // asking what's live now. Falls back to the live published set only when
  // the request carries no version at all (an older cached client, or a
  // non-browser caller).
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
      // A null here could be a transient blip (connection-pool timeout,
      // cold start) rather than something permanently unresolvable -- one
      // retry closes that common case for free.
      resolved = await getQuestionsForVersion(requestedVersion);
    }
    if (!resolved) {
      // Still unresolvable: nothing safe to validate, score, or snapshot
      // against, so no Submission row is written. But the answers must
      // not silently vanish -- a swallowed failure here once lost every
      // hosted submission for a day -- so alert staff with the raw
      // answers instead, extracted straight from the raw body since the
      // zod schema below is built from `questions`, which isn't available
      // on this path.
      const rawAnswers = bodyRecord.answers;
      const answersForAlert: Record<string, number> =
        rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)
          ? Object.fromEntries(
              Object.entries(rawAnswers as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number"
              )
            )
          : {};
      // Comments ride along for the same reason the answers do. This is
      // the one path where nothing is written, so context the respondent
      // typed would otherwise be destroyed exactly when it matters most.
      // validIds is unknowable here (the question set didn't resolve), so
      // every string key is accepted and the alert reports what was sent.
      // Truncated here as well as in normalizeComments: this path runs
      // BEFORE the zod parse, so neither the payload ceiling nor the UI cap
      // has been applied yet. Without the slice a scripted post could turn
      // this alert into a multi-megabyte email and push the send past its
      // timeout -- breaking the exact alert that exists to stop silent
      // data loss.
      const rawComments = bodyRecord.comments;
      const commentsForAlert: Record<string, string> =
        rawComments && typeof rawComments === "object" && !Array.isArray(rawComments)
          ? Object.fromEntries(
              Object.entries(rawComments as Record<string, unknown>)
                .filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string" && entry[1].trim().length > 0
                )
                .map(([id, text]) => [id, text.slice(0, MAX_COMMENT_LENGTH)])
            )
          : {};
      const prospectNameForAlert =
        typeof bodyRecord.prospectName === "string" ? bodyRecord.prospectName : "";
      const companyNameForAlert =
        typeof bodyRecord.companyName === "string" ? bodyRecord.companyName : "";

      const reason = `Could not resolve question set version ${requestedVersion} after a retry.`;
      console.error(reason);

      // This runs before the zod parse below (that schema needs
      // `questions`, unavailable on this path), so without a shape check
      // here a request that was never a genuine attempt -- no answers at
      // all, a fractional "version" that could never match a real row --
      // would still page staff with an alert about nothing.
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
            comments: commentsForAlert,
            // No score exists on this path, so `result` is correctly
            // omitted rather than fabricated.
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

      // 503, not 409: this isn't a conflict between the request and
      // server state, it's our own dependency (the question-set store)
      // failing twice in a row -- 503 correctly tells a caller retrying
      // shortly is reasonable.
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
    // Required by the landing page, so enforced here too rather than
    // trusting the client not to skip it -- same rule as name and company.
    email: z
      .string()
      .trim()
      .max(MAX_EMAIL_LENGTH)
      .refine(isPlausibleEmail, "A valid email address is required."),
    // Must be one of the published options, or a described "Other". The
    // dropdown is the only thing enforcing that in the browser, and a
    // hand-crafted request would otherwise put uncomparable free text
    // into the column the picklist exists to keep comparable.
    industry: z
      .string()
      .trim()
      .max(MAX_INDUSTRY_LENGTH + 16)
      .refine(isValidIndustry, "Please choose your industry."),
    // Optional per-question context. Deliberately permissive: keys are
    // filtered and values trimmed and truncated by normalizeComments
    // below, not rejected here. A note must never be able to fail a
    // submission -- neither an orphaned id from a set republished
    // mid-assessment nor an over-long paste should cost the respondent
    // five minutes of answers. The bound here is only an abuse ceiling.
    comments: z
      .record(z.string(), z.string().max(MAX_COMMENT_PAYLOAD_LENGTH))
      .optional(),
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

  const { answers, prospectName, companyName, email, industry } = parsed.data;
  const comments = normalizeComments(
    parsed.data.comments,
    questions.map((q) => q.id)
  );

  let result;
  try {
    result = scoreAssessment(answers, questions);
  } catch (e) {
    // Defense in depth: the zod schema above should already have caught
    // any missing/out-of-range answer scoreAssessment would throw on.
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
  // Resolved before the write so the failure alert can still reach
  // someone if the write itself is what fails.
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
        email,
        industry,
        answers,
        // null, never {}, when nothing was written -- see lib/comments.ts.
        comments: comments ?? undefined,
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
        // ever unreadable. See prisma/schema.prisma for the full rationale.
        questionSetSnapshot: toStored(questions) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // The person taking the assessment should still see their results
    // even if the save fails -- but a swallowed failure here once lost
    // every hosted submission for a day, indistinguishable from success
    // with nobody told. So the failure travels two ways now: `saved` goes
    // back to the client, and an alert goes to staff with the raw answers.
    saved = false;
    console.error("Failed to persist submission:", e);

    try {
      await sendPersistenceFailureAlert({
        prospectName,
        companyName,
        email,
        industry,
        recipients,
        answers,
        comments: comments ?? {},
        result,
        adminUrl,
        error: e,
      });
    } catch (alertError) {
      // sendPersistenceFailureAlert shouldn't throw; reaching here means
      // something unforeseen. Never let it mask the original data loss.
      console.error("Failed to raise persistence failure alert:", alertError);
    }
  }

  // Only for submissions that actually landed -- the routine "new
  // submission" email after a failed write would point staff at a
  // submission that isn't in the admin table at all.
  //
  // Awaited on purpose: a serverless function can be frozen or torn down
  // the moment the response is sent, so an un-awaited email risks never
  // going out. sendSubmissionNotification never throws, so this only adds
  // latency, it can't fail the response.
  if (saved) {
    notification = await sendSubmissionNotification({
      prospectName,
      companyName,
      email,
      industry,
      result,
      // Without this, context only ever reached staff when a submission
      // FAILED to save -- on the happy path the note sat in the run export
      // with nothing anywhere telling anyone to go download it.
      comments: comments ?? undefined,
      adminUrl,
      recipients,
    });
    if (!notification.sent) {
      console.log("Submission notification not sent:", notification.reason);
    }
  }

  // _notification is dev-only, so the email outcome shows up directly in
  // whatever's testing this endpoint instead of a separate server log --
  // never appears on a real deploy, so it can't leak mail status to a
  // client. `saved` ships in production too: the client needs it to tell
  // the person their results weren't recorded.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ...result, saved });
  }
  return NextResponse.json({ ...result, saved, _notification: notification });
}
