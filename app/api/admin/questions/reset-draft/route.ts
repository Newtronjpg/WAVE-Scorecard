import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveQuestions } from "@/lib/questionContent";
import { factoryQuestionSet, toStored, type StoredQuestion } from "@/lib/questionSet";

// Discards whatever is in the draft and reseeds it from the currently-live
// published version, the admin-designated default version, or the shipped
// factory defaults -- an admin's "start over" button.
//
// "default" is deliberately not lib/questions.ts's factoryQuestionSet():
// that literal is pinned by tests/scoring.test.ts and can never change
// shape, while "default" is whichever published version an admin has
// actually marked as their working baseline.

const resetSchema = z.object({
  to: z.enum(["live", "default", "factory"]),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected `to` to be "live", "default", or "factory".' },
      { status: 400 }
    );
  }

  try {
    let stored: StoredQuestion[];

    if (parsed.data.to === "factory") {
      stored = factoryQuestionSet();
    } else if (parsed.data.to === "default") {
      const defaultVersion = await db.questionSetVersion.findFirst({
        where: { isDefault: true },
      });

      if (defaultVersion) {
        const resolved = resolveQuestions(defaultVersion.questions);
        stored = resolved ? toStored(resolved) : factoryQuestionSet();
      } else {
        // No default has been designated yet -- fall back to the
        // original 5-choice literal rather than fail outright, so this
        // button always does SOMETHING sensible even before an admin has
        // set a default for the first time.
        stored = factoryQuestionSet();
      }
    } else {
      const latest = await db.questionSetVersion.findFirst({
        orderBy: { version: "desc" },
      });

      if (latest) {
        const resolved = resolveQuestions(latest.questions);
        stored = resolved ? toStored(resolved) : factoryQuestionSet();
      } else {
        // Nothing has ever been published -- factory is the only sensible
        // "live".
        stored = factoryQuestionSet();
      }
    }

    await db.questionDraft.upsert({
      where: { id: "draft" },
      create: { id: "draft", questions: stored as unknown as Prisma.InputJsonValue },
      update: { questions: stored as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Failed to reset the question draft:", e);
    return NextResponse.json(
      { error: "Could not reset. Please try again." },
      { status: 500 }
    );
  }
}
