import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ADVISOR_WRITE_WINDOW_MS, normalizeAdvisorRatings } from "@/lib/advisors";
import { checkRateLimit, clientIdentifier } from "@/lib/rateLimit";

// Records how well a respondent's other advisers are serving them, after
// their submission row already exists.
//
// This endpoint exists because the section moved onto the results page,
// behind a button, rather than standing as a step between the last gap and
// the results. By the time it is answered /api/submit has written the row and
// sent the completion email, so the answer cannot ride along with either -- it
// has to come back on its own. Nothing here sends mail: Brandon's call is
// that a second email is not worth it, and staff read the answer in the admin
// table and the exports.
//
// Public and unauthenticated, like /api/submit and /api/follow-up, because the
// person answering has no account. What keeps that safe is that it can only
// ever write ONE column, on a row whose cuid the caller already had to know,
// and it is throttled on its own bucket so hammering it cannot use up someone
// else's ability to submit.

// Generous relative to the submit limit: opening the panel, changing a
// rating, naming a firm and saving again are all legitimate repeat calls from
// one person on one results page, and each is a cheap one-column update
// rather than a row plus an email.
const ADVISORS_MAX_PER_WINDOW = 30;
const ADVISORS_WINDOW_MS = 60 * 60 * 1000; // one hour

const advisorsSchema = z.object({
  // A cuid from /api/submit. Bounded so a scripted caller cannot make the
  // database chew on a megabyte of "id".
  submissionId: z.string().trim().min(1).max(64),
  // Unknown on purpose -- unknown areas, out-of-range ratings and over-long
  // names are filtered and truncated by normalizeAdvisorRatings rather than
  // rejected here. This section is optional by design, and one bad field must
  // never discard the good one beside it.
  advisorRatings: z.unknown(),
});

export async function POST(req: NextRequest) {
  const limit = await checkRateLimit(
    // Prefixed so this shares no counter with /api/submit or /api/follow-up.
    // Rating your advisers must never consume an attempt at submitting, and a
    // script hammering this must never lock a real prospect out.
    `advisors:${clientIdentifier(req.headers)}`,
    ADVISORS_MAX_PER_WINDOW,
    ADVISORS_WINDOW_MS
  );
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
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = advisorsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { submissionId } = parsed.data;
  // Null, never {}, when nothing survived: someone who rated an area and then
  // tapped it off again has withdrawn the answer, and "said nothing" should
  // have one representation rather than two.
  const advisorRatings = normalizeAdvisorRatings(parsed.data.advisorRatings);

  try {
    // updateMany, not update, because the guard belongs in the WHERE clause --
    // see ADVISOR_WRITE_WINDOW_MS for why the age bound is the thing doing the
    // authorising here.
    const { count } = await db.submission.updateMany({
      where: {
        id: submissionId,
        createdAt: { gt: new Date(Date.now() - ADVISOR_WRITE_WINDOW_MS) },
      },
      data: {
        // The cast questionSetSnapshot needs for the same reason: Prisma's
        // InputJsonValue wants an index signature, which a
        // Partial<Record<union, ...>> does not have even though its shape is
        // plain JSON. DbNull rather than undefined, because clearing the
        // section has to actually clear the column.
        advisorRatings:
          (advisorRatings as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
      },
    });

    if (count === 0) {
      // No row, or one too old to still be accepting an answer. Deliberately
      // the same response for both, since telling an unauthenticated caller
      // which of the two it was would confirm that an id exists.
      return NextResponse.json({ error: "Could not record that." }, { status: 404 });
    }
  } catch (e) {
    console.error("Failed to record advisor ratings:", e);
    return NextResponse.json(
      { error: "We couldn't record that just now." },
      { status: 503 }
    );
  }

  return NextResponse.json({ recorded: true });
}
