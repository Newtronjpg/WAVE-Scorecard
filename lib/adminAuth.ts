// The assessment itself is open (no login, nothing regulated). The admin
// view lists every submission, so it's passcode-gated -- each staff member
// gets their own named passcode in ADMIN_USERS ("Name:passcode", comma-
// separated) rather than one shared secret, so access can be revoked per
// person and the app can show who's logged in.
//
// This runs inside Next.js middleware on the Edge runtime, not Node, so
// `crypto.timingSafeEqual` isn't available -- the comparison below is
// written by hand from character codes instead.

export const ADMIN_COOKIE_NAME = "wave_admin";

export interface AdminUser {
  name: string;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  // Always compare the same number of bytes regardless of where the
  // strings first differ, and regardless of a length mismatch, so
  // execution time doesn't reveal how much of the guess was correct.
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

// Strips wrapping quotes and whitespace: a .env file needs quotes
// (`ADMIN_USERS="Name:pass"`) and dotenv strips them, but pasting the same
// quoted string into a hosting dashboard's UI stores the quotes literally,
// silently turning the passcode into `pass"` otherwise.
function clean(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "").trim();
}

function getAdminUsers(): { name: string; passcode: string }[] {
  const raw = (process.env.ADMIN_USERS ?? "").trim();
  if (!raw) return [];

  // A value with no colon at all is treated as a single bare passcode
  // under a default name, rescuing the common mistake of setting
  // ADMIN_USERS to a plain string instead of "Name:passcode".
  if (!raw.includes(":")) {
    const passcode = clean(raw);
    return passcode ? [{ name: "Admin", passcode }] : [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex === -1) return null;
      const name = clean(entry.slice(0, separatorIndex));
      const passcode = clean(entry.slice(separatorIndex + 1));
      if (!name || !passcode) return null;
      return { name, passcode };
    })
    .filter((u): u is { name: string; passcode: string } => u !== null);
}

// Looks up which named user a passcode belongs to, checking every entry
// with the same constant-time comparison. Returns null for no match
// (including when ADMIN_USERS isn't set at all, fail closed rather than
// treating a missing config as "no auth required").
export function matchAdminUser(input: string): AdminUser | null {
  for (const user of getAdminUsers()) {
    if (timingSafeStringEqual(input, user.passcode)) {
      return { name: user.name };
    }
  }
  return null;
}

export function isValidPasscode(input: string): boolean {
  return matchAdminUser(input) !== null;
}
