import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Permanently deletes one submission. Passcode-gated by proxy.ts.
//
// This is a hard delete, by design: the admin table is a working list of
// real prospects, and an "archived" tier would need its own UI to ever be
// useful. The confirmation step lives in the admin UI.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing submission id." }, { status: 400 });
  }

  try {
    await db.submission.delete({ where: { id } });
  } catch (e) {
    // Prisma throws P2025 when the row does not exist. Treating that as a
    // 404 rather than a 500 keeps a double-click from looking like a
    // server fault.
    const code = (e as { code?: string })?.code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }
    console.error("Failed to delete submission:", e);
    return NextResponse.json(
      { error: "Could not delete. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
