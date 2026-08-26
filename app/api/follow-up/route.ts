import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rateLimit";
import { resolveAdminUrl, sendFollowUpRequest } from "@/lib/email";
import { getNotifyRecipients } from "@/lib/settings";

// Records whether a respondent wants to talk to someone.
//
// A separate endpoint rather than part of /api/submit because the answer
// is given on the results page, which only exists after the submission
// row has already been written.
//
// The write surface is deliberately tiny: it sets exactly one boolean on
// one row, addressed by a cuid the caller can only know because the
// server just handed it to them. It cannot create, delete, or read a
// submission, and it cannot touch answers, scores, or contact details --
// so the worst a guessed id achieves is flipping one flag on a
// submission the guesser still cannot see.

const followUpSchema = z.object({
  submissionId: z.string().min(1).max(64),
  interested: z.boolean(),
});

// One message for every failure. A malformed body, an unknown id, and a
// database outage are all "we could not record it" from the caller's side,
// and distinguishing them would let anyone probe whether a submission id
// exists, one guess at a time. The respondent never sees this string --
// FollowUpPrompt shows its own wording.
const FAILURE = { error: "Could not record your answer." };

export async function POST(req: NextRequest) {
  // Throttled for the same reason /api/submit is: public, and a "yes"
  // sends an email.
  const limit = await checkRateLimit(clientIdentifier(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(FAILURE, { status: 400 });
  }

  const parsed = followUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(FAILURE, { status: 400 });
  }
  const { submissionId, interested } = parsed.data;

  let submission;
  try {
    submission = await db.submission.update({
      where: { id: submissionId },
      data: { followUpInterest: interested },
      select: {
        prospectName: true,
        companyName: true,
        email: true,
        industry: true,
        overallScore: true,
        readinessBand: true,
      },
    });
  } catch (e) {
    // An unknown id lands here too, and gets the same FAILURE as every
    // other path -- see the note on that constant.
    console.error("Failed to record follow-up interest:", e);
    return NextResponse.json(FAILURE, { status: 400 });
  }

  // Only "yes" is worth an email. The results page has already told the
  // respondent someone will reach out, and the submission notification
  // went out before this question was even answered -- so without this
  // the promise depends on somebody happening to check the dashboard.
  if (interested) {
    try {
      await sendFollowUpRequest({
        prospectName: submission.prospectName ?? "",
        companyName: submission.companyName ?? "",
        email: submission.email ?? undefined,
        industry: submission.industry ?? undefined,
        overallScore: submission.overallScore,
        readinessBand: submission.readinessBand,
        recipients: await getNotifyRecipients(),
        adminUrl: resolveAdminUrl(req.nextUrl.origin),
      });
    } catch (e) {
      // The answer is already stored and visible in the admin table, so a
      // failed email must not fail the request or worry the respondent.
      console.error("Failed to send follow-up request email:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
