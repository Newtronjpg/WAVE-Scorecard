import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateQuestionSet, type StoredQuestion } from "@/lib/questionSet";

// Publishes the current draft as a new, immutable, numbered version. This
// is the only path that makes a question set "live" -- the public
// assessment always serves the highest-numbered QuestionSetVersion row.

const publishSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 0) {
      body = JSON.parse(text);
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 }
    );
  }

  // The literal draft row is the ONLY path into publication -- never the
  // fallback-softened getDraftQuestions result. publish must refuse
  // loudly when there is no draft row, or when the draft itself is
  // corrupt, rather than silently publish whatever getDraftQuestions
  // degraded to. That fallback used to exist here; it was removed because
  // it both bypassed validateQuestionSet (factoryWithOverrides is never
  // revalidated, so an out-of-bounds legacy QuestionOverride could reach
  // QuestionSetVersion undetected) and would silently ship content the
  // admin never opened. The admin editor always loads and saves a draft
  // before publishing, so refusing here costs nothing in the real flow.
  let questions: StoredQuestion[];
  try {
    const row = await db.questionDraft.findUnique({ where: { id: "draft" } });

    if (!row) {
      return NextResponse.json(
        { error: "Save the draft before publishing.", errors: [] },
        { status: 400 }
      );
    }

    const validated = validateQuestionSet(row.questions);
    if (!validated.ok) {
      return NextResponse.json(
        {
          error: "The draft is invalid and cannot be published.",
          errors: validated.errors,
        },
        { status: 400 }
      );
    }
    questions = validated.questions;

    const latest = await db.questionSetVersion.findFirst({
      orderBy: { version: "desc" },
    });
    // Highest existing + 1, never count + 1: a gap in the sequence would
    // otherwise collide on the primary key.
    const version = (latest?.version ?? 0) + 1;

    await db.questionSetVersion.create({
      data: {
        version,
        questions: questions as unknown as Prisma.InputJsonValue,
        note: parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null,
      },
    });

    return NextResponse.json({ ok: true, version });
  } catch (e) {
    console.error("Failed to publish the question set:", e);
    return NextResponse.json(
      { error: "Could not publish. Please try again." },
      { status: 500 }
    );
  }
}
