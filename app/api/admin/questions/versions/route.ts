import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Read-only list of every published version, newest first -- backs the
// admin editor's version history / rollback UI (components/VersionHistory.tsx).
// Selects only the metadata columns, not `questions` itself (large, and
// unused by that list), so this stays cheap regardless of how many
// versions have accumulated or how big the question set is.

export async function GET() {
  try {
    const versions = await db.questionSetVersion.findMany({
      orderBy: { version: "desc" },
      select: { version: true, note: true, publishedAt: true, isDefault: true },
    });

    return NextResponse.json({
      versions: versions.map((v) => ({
        version: v.version,
        note: v.note,
        publishedAt: v.publishedAt.toISOString(),
        isDefault: v.isDefault,
      })),
    });
  } catch (e) {
    console.error("Failed to read question set versions:", e);
    return NextResponse.json(
      { error: "Could not load version history. Please try again." },
      { status: 500 }
    );
  }
}
