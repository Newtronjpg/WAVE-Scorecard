import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildSubmissionsWorkbook } from "@/lib/excel";

export async function GET() {
  const submissions = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
  });
  const versions = await db.questionSetVersion.findMany({
    orderBy: { version: "asc" },
  });

  const buffer = await buildSubmissionsWorkbook(submissions, versions);
  const filename = `wave-scorecard-submissions-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
