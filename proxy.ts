import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isValidPasscode } from "@/lib/adminAuth";

// Protects everything under /admin and /api/admin except the login page
// and the login API route themselves (which would otherwise be
// unreachable). The assessment itself (/, /api/submit) is intentionally
// left open, per Noah: it's going to Ben first and isn't handling
// anything regulated yet. The admin view is different, it lists every
// submission's name/company/answers, so it gets a passcode gate.
//
// The cookie's value is never trusted on its own; it just carries the
// passcode, which is re-checked with the same timing-safe comparison on
// every request. That trades a slightly heavier check for not needing a
// session store for what is, today, a single shared passcode.

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtectedPage = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isProtectedApi =
    pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const cookieValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

  if (!cookieValue || !isValidPasscode(cookieValue)) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
