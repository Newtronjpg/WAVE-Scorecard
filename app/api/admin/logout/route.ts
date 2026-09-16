import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/adminAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Must match how the cookie was set, or the browser treats this as a
    // different cookie and quietly leaves the live one in place.
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
