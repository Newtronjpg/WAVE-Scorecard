import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, getAdminUserNames } from "@/lib/adminAuth";
import { verifySessionToken } from "@/lib/adminSession";

// Protects everything under /admin and /api/admin except the login page
// and the login API route themselves (which would otherwise be
// unreachable). The assessment itself (/, /api/submit) is intentionally
// left open: it isn't handling anything regulated. The admin view is
// different, it lists every submission's name/company/answers, so it
// gets a gate.
//
// The cookie carries a SIGNED SESSION TOKEN, not a passcode. It used to carry
// the passcode itself, re-checked on every request -- which made the cookie a
// copy of the credential and gave it no expiry the server enforced. See
// lib/adminSession.ts for what that cost.
//
// Two things are checked, and the second is the reason the name is in the
// token at all: the signature and expiry must hold, AND the named user must
// still exist in ADMIN_USERS. That preserves the one genuinely good property
// of the old design -- removing someone from ADMIN_USERS locks them out
// immediately, rather than leaving them holding a valid token until it
// expires on its own.

// Sent on every response, not just admin ones, because the assessment is the
// page strangers actually load.
const SECURITY_HEADERS: Record<string, string> = {
  // No plugins, no framing, no MIME sniffing.
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Nothing here uses any of these, so refuse them rather than leaving them
  // available to injected script.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // HSTS. Vercel serves HTTPS only; this stops a downgrade on the first hop.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

// Content-Security-Policy is separate because it needs a per-request nonce
// budget it does not have here. Next injects inline bootstrap script, so
// 'unsafe-inline' is unavoidable for script-src without adopting nonces
// throughout; everything that CAN be locked down is.
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The app talks to nothing but itself.
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function harden(res: NextResponse): NextResponse {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(header, value);
  }
  res.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtectedPage = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isProtectedApi =
    pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";

  if (!isProtectedPage && !isProtectedApi) {
    return harden(NextResponse.next());
  }

  const session = await verifySessionToken(
    req.cookies.get(ADMIN_COOKIE_NAME)?.value
  );

  // Revocation: a token is only as good as the account it names still being
  // configured. Removing someone from ADMIN_USERS takes effect on their very
  // next request, without waiting for the session to expire.
  const stillConfigured =
    session !== null && getAdminUserNames().includes(session.name);

  if (!stillConfigured) {
    if (isProtectedApi) {
      return harden(
        NextResponse.json({ error: "Unauthorized." }, { status: 401 })
      );
    }
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    const res = harden(NextResponse.redirect(loginUrl));
    // Clear a cookie that will not work again, so an expired session does not
    // keep being presented on every subsequent request.
    res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  }

  return harden(NextResponse.next());
}

export const config = {
  // Everything except Next's own static output, so the assessment carries the
  // security headers too. Static assets do not need them and skipping those
  // keeps the middleware off the hot path.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
