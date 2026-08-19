import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// Rolling back never deletes or edits history: it appends a new version
// carrying an old version's questions forward, so QuestionSetVersion stays
// a true append-only log of what was live and when.

const rollbackSchema = z.object({
  version: z.number().int(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = rollbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected a `version` number." }, { status: 400 });
  }

  try {
    const target = await db.questionSetVersion.findUnique({
      where: { version: parsed.data.version },
    });

    if (!target) {
      return NextResponse.json(
        { error: `Version ${parsed.data.version} does not exist.` },
        { status: 404 }
      );
    }

    const latest = await db.questionSetVersion.findFirst({
      orderBy: { version: "desc" },
    });
    // Highest existing + 1, never count + 1: a gap in the sequence would
    // otherwise collide on the primary key.
    const version = (latest?.version ?? 0) + 1;

    await db.questionSetVersion.create({
      data: {
        version,
        questions: target.questions as unknown as Prisma.InputJsonValue,
        note: `Rolled back to version ${target.version}.`,
      },
    });

    return NextResponse.json({ ok: true, version });
  } catch (e) {
    console.error("Failed to roll back the question set:", e);
    return NextResponse.json(
      { error: "Could not roll back. Please try again." },
      { status: 500 }
    );
  }
}
