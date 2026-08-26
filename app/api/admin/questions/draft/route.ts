import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getDraftQuestions, getPublishedQuestions } from "@/lib/questionContent";
import { toStored, validateQuestionSet } from "@/lib/questionSet";

// Reads and replaces the single working draft row (id "draft"). The admin
// editor operates on the whole set at once -- add, delete, and reorder are
// all just a new array here -- which is what keeps those operations atomic.

const draftPutSchema = z.object({
  questions: z.unknown(),
  // The updatedAt the client loaded, echoed back for optimistic
  // concurrency. Absent (never saved before) or omitted (client doesn't
  // want the check) both skip the conflict check below.
  updatedAt: z.string().nullish(),
});

// The admin editor's initial load: the current draft content (falling
// back to the published set, then the factory set, per
// getDraftQuestions), plus the version currently live so the UI can show
// "editing draft, version 3 is published".
export async function GET() {
  const draft = await getDraftQuestions();
  const published = await getPublishedQuestions();

  return NextResponse.json({
    questions: toStored(draft.questions),
    updatedAt: draft.updatedAt ? draft.updatedAt.toISOString() : null,
    publishedVersion: published.version,
    // Lets the editor tell "no draft yet" apart from "a draft row exists
    // but is unreadable" -- both report updatedAt: null, but only the
    // second is real content a blind overwrite would destroy. See
    // getDraftQuestions's own comment in lib/questionContent.ts.
    source: draft.source,
  });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = draftPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Expected a `questions` array.",
        errors: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 }
    );
  }

  const validated = validateQuestionSet(parsed.data.questions);
  if (!validated.ok) {
    return NextResponse.json(
      { error: "The question set is invalid.", errors: validated.errors },
      { status: 400 }
    );
  }

  try {
    // Optimistic concurrency. The admin passcode is shared, so two people
    // can hold the editor at once; without this the second save silently
    // discards the first person's work.
    //
    // Whenever a draft row exists, a matching updatedAt is required --
    // omitted, null, or mismatched all 409. Only when there's no draft row
    // at all may updatedAt be absent. This is stricter than "409 only on a
    // mismatch" on purpose: getDraftQuestions reports updatedAt: null for
    // both "no draft row" and "draft row exists but is unreadable," and
    // treating a nullish updatedAt as "no conflict possible" would let a
    // client blind-overwrite real content in the second case.
    const existing = await db.questionDraft.findUnique({ where: { id: "draft" } });

    if (existing) {
      if (
        !parsed.data.updatedAt ||
        existing.updatedAt.toISOString() !== parsed.data.updatedAt
      ) {
        return NextResponse.json(
          {
            error:
              "Someone else changed the draft while you were editing. Reload to get their changes before saving.",
          },
          { status: 409 }
        );
      }
    }

    const written = await db.questionDraft.upsert({
      where: { id: "draft" },
      create: {
        id: "draft",
        questions: validated.questions as unknown as Prisma.InputJsonValue,
      },
      update: {
        questions: validated.questions as unknown as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ ok: true, updatedAt: written.updatedAt.toISOString() });
  } catch (e) {
    console.error("Failed to save the question draft:", e);
    return NextResponse.json(
      { error: "Could not save. Please try again." },
      { status: 500 }
    );
  }
}
