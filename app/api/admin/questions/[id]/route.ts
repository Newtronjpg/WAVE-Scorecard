import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getQuestion } from "@/lib/questions";

// Saves or clears the wording override for one question.
//
// Only text is accepted. The question's id, gap, and each level's tier
// and value are structural and come from lib/questions.ts, so they are
// deliberately absent from this schema: an edit here can never change a
// score, invalidate a stored submission, or alter the Combo Rules'
// tier vocabulary.

const MAX_STATEMENT = 400;
const MAX_LABEL = 80;
const MAX_DESCRIPTION = 600;

const payloadSchema = z.object({
  statement: z.string().trim().min(1, "Statement cannot be empty.").max(MAX_STATEMENT),
  // Exactly five, in order. A partial set is rejected rather than merged,
  // so a question can never end up showing a mix of new and old levels.
  levels: z
    .array(
      z.object({
        label: z.string().trim().min(1, "Label cannot be empty.").max(MAX_LABEL),
        description: z
          .string()
          .trim()
          .min(1, "Description cannot be empty.")
          .max(MAX_DESCRIPTION),
      })
    )
    .length(5, "All five rating levels are required."),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!getQuestion(id)) {
    return NextResponse.json({ error: `Unknown question "${id}".` }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Invalid question content." },
      { status: 400 }
    );
  }

  const levels = parsed.data.levels.map((level, index) => ({
    value: index + 1,
    label: level.label,
    description: level.description,
  }));

  try {
    await db.questionOverride.upsert({
      where: { questionId: id },
      create: { questionId: id, statement: parsed.data.statement, levels },
      update: { statement: parsed.data.statement, levels },
    });
  } catch (e) {
    console.error("Failed to save question override:", e);
    return NextResponse.json(
      { error: "Could not save. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

// Resetting to the original wording is simply removing the override row,
// which is why the defaults were never copied into the database.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!getQuestion(id)) {
    return NextResponse.json({ error: `Unknown question "${id}".` }, { status: 404 });
  }

  try {
    await db.questionOverride.deleteMany({ where: { questionId: id } });
  } catch (e) {
    console.error("Failed to reset question override:", e);
    return NextResponse.json(
      { error: "Could not reset. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
