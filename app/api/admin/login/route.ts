import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  hasPlaintextPasscodes,
  verifyAdminPasscode,
} from "@/lib/adminAuth";
import { SESSION_TTL_MS, createSessionToken } from "@/lib/adminSession";
import { checkRateLimit, clientIdentifier } from "@/lib/rateLimit";

// The one place a passcode is checked. Everything after this presents a
// signed session token instead, so the credential itself is handled once per
// login rather than on every request.

// Ten attempts an hour from one address. A staff member who mistypes twice is
// unaffected; anybody working through a list is not.
const LOGIN_MAX_PER_WINDOW = 10;
const LOGIN_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  // FAIL CLOSED here, unlike /api/submit.
  //
  // The submit throttle fails open on purpose: losing it costs us junk rows,
  // while wrongly blocking costs a real prospect their assessment. The trade
  // inverts completely on a login. If the throttle store is unreachable,
  // allowing unlimited guessing is far worse than telling staff to try again
  // in a minute, so a broken throttle denies rather than waves through.
  const limit = await checkRateLimit(
    `admin-login:${clientIdentifier(req.headers)}`,
    LOGIN_MAX_PER_WINDOW,
    LOGIN_WINDOW_MS,
    { failOpen: false }
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }
    );
  }

  const body = await req.json().catch(() => null);
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  const user = await verifyAdminPasscode(passcode);
  if (!user) {
    // One message for every failure. Naming the reason -- unknown user, wrong
    // passcode, nothing configured -- tells a guesser which half they got right.
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }

  const token = await createSessionToken(user.name);
  if (!token) {
    console.error("Admin session could not be signed; check ADMIN_USERS.");
    return NextResponse.json({ error: "Sign-in is unavailable." }, { status: 503 });
  }

  if (hasPlaintextPasscodes()) {
    // Loud, because it is invisible otherwise and the fix is one script run.
    console.warn(
      "ADMIN_USERS still contains plaintext passcodes. " +
        "Run scripts/hash-admin-passcode.ts and replace them."
    );
  }

  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // strict, not lax: nothing here is reached by following a link from
    // somewhere else, so there is no flow to preserve, and strict removes
    // cross-site request forgery as a category rather than mitigating it.
    sameSite: "strict",
    path: "/",
    // Matches the token's own expiry, so the browser drops the cookie at the
    // same moment the server stops honouring it. The server's check is the
    // one that matters -- this only avoids sending a cookie known to be dead.
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
