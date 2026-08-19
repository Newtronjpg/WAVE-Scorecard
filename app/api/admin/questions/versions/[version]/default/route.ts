import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Marks one published version as THE default -- what "Reset to default"
// in the editor loads. At most one version is ever default at a time:
// unsetting every other version and setting this one happens inside a
// single transaction, so a request that fails partway through can never
// leave two versions (or, on retry races, momentarily zero) marked
// default in a way a later read could observe.
//
// Deliberately separate from Publish and Rollback: designating a
// default doesn't change what's live, doesn't touch the draft, and
// doesn't append a new version. It only changes what a future
// "Reset to default" click will load.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ version: string }> }
) {
  const { version: versionParam } = await params;
  const version = Number(versionParam);

  if (!Number.isInteger(version)) {
    return NextResponse.json({ error: "Invalid version." }, { status: 400 });
  }

  try {
    const target = await db.questionSetVersion.findUnique({ where: { version } });
    if (!target) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }

    await db.$transaction([
      db.questionSetVersion.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      db.questionSetVersion.update({
        where: { version },
        data: { isDefault: true },
      }),
    ]);
  } catch (e) {
    console.error("Failed to set default question set version:", e);
    return NextResponse.json(
      { error: "Could not set as default. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
