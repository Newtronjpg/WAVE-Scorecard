import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveQuestions } from "@/lib/questionContent";
import { factoryQuestionSet, toStored, type StoredQuestion } from "@/lib/questionSet";

// Discards whatever is in the draft and reseeds it from either the
// currently-live published version or the shipped factory defaults -- an
// admin's "start over" button.

const resetSchema = z.object({
  to: z.enum(["live", "factory"]),
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
      { error: 'Expected `to` to be "live" or "factory".' },
      { status: 400 }
    );
  }

  try {
    let stored: StoredQuestion[];

    if (parsed.data.to === "factory") {
      stored = factoryQuestionSet();
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
