import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  FOLLOW_UP_WRITE_WINDOW_MS,
  MAX_FOLLOW_UP_NOTE_PAYLOAD_LENGTH,
  normalizeFollowUpNote,
} from "@/lib/followUp";
import { checkRateLimit, clientIdentifier } from "@/lib/rateLimit";

// Records whether a respondent wants a conversation, and what they would like
// it to cover, after their submission row already exists.
//
// This endpoint exists because the question moved to the results page. By the
// time it is asked, /api/submit has written the row and sent the completion
// email, so the answer cannot ride along with either -- it has to come back on
// its own. Nothing here sends mail: Brandon's call is that a second email is
// not worth it, and staff read the answer in the admin table and the exports.
//
// Public and unauthenticated, like /api/submit, because the person answering
// has no account. What keeps that safe is that it can only ever write two
// columns, on a row whose cuid the caller already had to know, and it is
// throttled on its own bucket so hammering it cannot use up someone else's
// ability to submit.

// Generous relative to the submit limit: answering, changing your mind, and
// editing the note are all legitimate repeat calls from one person on one
// results page, and each one is a cheap two-column update rather than a row
// plus an email.
const FOLLOW_UP_MAX_PER_WINDOW = 30;
const FOLLOW_UP_WINDOW_MS = 60 * 60 * 1000; // one hour

const followUpSchema = z.object({
  // A cuid from /api/submit. Bounded so a scripted caller cannot make the
  // database chew on a megabyte of "id".
  submissionId: z.string().trim().min(1).max(64),
  // Null is a real value: it is how someone un-answers by tapping their
  // choice again, and it must be storable rather than ignored.
  followUpInterest: z.boolean().nullable(),
  // Permissive on purpose -- trimmed, truncated and emptied-to-null by
  // normalizeFollowUpNote rather than rejected. A note must never be able to
  // fail the write that carries the answer staff actually care about.
  followUpNote: z
    .string()
    .max(MAX_FOLLOW_UP_NOTE_PAYLOAD_LENGTH)
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const limit = await checkRateLimit(
    // Prefixed so this shares no counter with /api/submit. Answering the
    // follow-up must never consume an attempt at submitting, and a script
    // hammering this must never lock a real prospect out of the assessment.
    `follow-up:${clientIdentifier(req.headers)}`,
    FOLLOW_UP_MAX_PER_WINDOW,
    FOLLOW_UP_WINDOW_MS
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

  const parsed = followUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { submissionId, followUpInterest } = parsed.data;
  // A note only means anything alongside a yes. Someone who types one and then
  // switches to "not at this time" has withdrawn it, and keeping it would put
  // words in the mouth of a person who just declined.
  const followUpNote =
    followUpInterest === true ? normalizeFollowUpNote(parsed.data.followUpNote) : null;

  try {
    // updateMany, not update, because the guard belongs in the WHERE clause.
    //
    // Knowing a submission id is the ONLY thing authorising this write -- the
    // endpoint is public, and it has to be, because the person answering has
    // no account. A cuid is not a security token (Prisma's cuid v1 is a
    // timestamp, a counter, a stable host fingerprint and a short random
    // block), so the id alone should not grant an unlimited, permanent right
    // to rewrite a row. The age check bounds that: the results page is open
    // immediately after submitting, so a legitimate answer always lands well
    // inside the window, while a replayed or guessed id from any earlier
    // session is simply not writable.
    const { count } = await db.submission.updateMany({
      where: {
        id: submissionId,
        createdAt: { gt: new Date(Date.now() - FOLLOW_UP_WRITE_WINDOW_MS) },
      },
      data: { followUpInterest, followUpNote },
    });

    if (count === 0) {
      // No row, or one too old to still be accepting an answer. Genuinely the
      // caller's problem and not ours, so 404 -- and deliberately the same
      // response for both, since telling an unauthenticated caller which of
      // the two it was would confirm that an id exists.
      return NextResponse.json({ error: "Could not record that." }, { status: 404 });
    }
  } catch (e) {
    // Reached only when the database itself failed. This used to return 404
    // as well, which made an outage indistinguishable from a bad id in both
    // the logs and the client -- and told the client not to bother retrying
    // something that was in fact worth retrying.
    console.error("Failed to record follow-up answer:", e);
    return NextResponse.json(
      { error: "We couldn't record that just now." },
      { status: 503 }
    );
  }

  return NextResponse.json({ recorded: true });
}
