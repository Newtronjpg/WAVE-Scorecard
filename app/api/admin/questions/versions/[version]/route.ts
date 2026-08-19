import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Permanently deletes one published version -- for cleaning up a
// version that was never meant to exist (a test publish, a mistake),
// not a way to edit history. Rolling back stays append-only; this is a
// separate, deliberate action.
//
// Refuses to delete the CURRENTLY LIVE version: the public assessment
// always serves the highest-numbered row, so deleting it would silently
// change what's live without ever going through Publish or Rollback --
// exactly the safety boundary those two routes exist to protect.
//
// Safe for every submission that already answered against the deleted
// version: each one carries its own literal question-set snapshot
// (Submission.questionSetSnapshot, see app/api/submit/route.ts), so
// nothing about a past submission's own record or export depends on
// this row continuing to exist. The only thing that changes is the
// version no longer appears in the admin's version history or in the
// summary export's "Question sets" reference sheet.

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
