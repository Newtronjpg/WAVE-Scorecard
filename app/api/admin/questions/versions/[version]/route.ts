import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Permanently deletes one published version -- for cleaning up a version
// that was never meant to exist, not a way to edit history. Rolling back
// stays append-only; this is separate.
//
// Refuses to delete the currently live version, since the public
// assessment always serves the highest-numbered row and deleting it would
// silently change what's live without going through Publish or Rollback.
// Safe for past submissions either way: each carries its own literal
// question-set snapshot (Submission.questionSetSnapshot), so nothing
// about a past record depends on this row continuing to exist.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ version: string }> }
) {
  const { version: versionParam } = await params;
  const version = Number(versionParam);

  if (!Number.isInteger(version)) {
    return NextResponse.json({ error: "Invalid version." }, { status: 400 });
  }

  try {
    const latest = await db.questionSetVersion.findFirst({
      orderBy: { version: "desc" },
    });

    if (latest && latest.version === version) {
      return NextResponse.json(
        {
          error:
            "Can't delete the live version. Publish or roll back to a different version first.",
        },
        { status: 400 }
      );
    }

    await db.questionSetVersion.delete({ where: { version } });
  } catch (e) {
    // Prisma throws P2025 when the row does not exist. Treating that as a
    // 404 rather than a 500 keeps a double-click from looking like a
    // server fault.
    const code = (e as { code?: string })?.code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }
    console.error("Failed to delete question set version:", e);
    return NextResponse.json(
      { error: "Could not delete. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
