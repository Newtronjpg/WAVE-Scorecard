import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildRunWorkbook } from "@/lib/excelRun";
import { withDerivedTiers } from "@/lib/questionSet";
import { resolveQuestions } from "@/lib/questionContent";
import { QUESTIONS, type Question } from "@/lib/questions";

// Reconstructs exactly what this run was scored against, preferring the
// literal snapshot stored on the row since it needs no lookup and can
// never drift -- falling back to the QuestionSetVersion table only for
// older rows written before that column existed, and to the factory set
// as the last resort when neither is available.
async function resolveRunQuestions(
  snapshot: unknown,
  version: number | null
): Promise<{ questions: Question[]; label: string }> {
  if (snapshot) {
    const stored = snapshot as Parameters<typeof withDerivedTiers>[0];
    const questions = withDerivedTiers(stored);
    return { questions, label: version !== null ? `version ${version}` : "factory" };
  }

  if (version !== null) {
    const row = await db.questionSetVersion.findUnique({ where: { version } });
    if (row) {
      const resolved = resolveQuestions(row.questions);
      if (resolved) {
        return { questions: resolved, label: `version ${version}` };
      }
    }
  }

  return { questions: QUESTIONS, label: "factory (version not recorded)" };
}

function sanitizeFilenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const submission = await db.submission.findUnique({ where: { id } });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const { questions, label } = await resolveRunQuestions(
    submission.questionSetSnapshot,
    submission.questionSetVersion
  );

  const buffer = await buildRunWorkbook(submission, questions, label);

  const date = submission.createdAt.toISOString().slice(0, 10);
  const company = sanitizeFilenamePart(submission.companyName ?? "prospect");
  const filename = `wave-${company}-${date}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
