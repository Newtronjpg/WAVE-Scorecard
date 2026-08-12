import { NextRequest, NextResponse } from "next/server";
import { setNotifyRecipients, validateRecipients } from "@/lib/settings";

// Saves the notification recipient list. Reachable only through the
// passcode gate in proxy.ts, which matches /api/admin/:path*.

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = (body as { recipients?: unknown })?.recipients;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { error: "Expected a `recipients` string." },
      { status: 400 }
    );
  }

  const validated = validateRecipients(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    await setNotifyRecipients(validated.value);
  } catch (e) {
    console.error("Failed to save notification recipients:", e);
    return NextResponse.json(
      { error: "Could not save. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, recipients: validated.value });
}
