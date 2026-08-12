// The assessment link itself is intentionally open (no login), per Noah:
// it's going to Ben first and isn't handling anything regulated yet. The
// admin view is different: it lists every submission, including whatever
// name/company a prospect entered, so it's passcode-gated.
//
// Now that a few F&W staff (not just Ben) need admin access, this is
// deliberately NOT a single shared secret anymore. Each person gets their
// own named passcode in ADMIN_USERS, a comma-separated "Name:passcode"
// list, e.g. ADMIN_USERS="Ben:fw-ben-2026,Sarah:fw-sarah-8841". Benefits
// over one shared string: the app can show who's logged in, and revoking
// one person's access later means deleting their entry, not changing the
// passcode for everyone else too. It's still not full SSO, no
// centralized identity provider, no per-person audit log beyond "who's
// currently logged in", but it's a real step up from one secret four
// people all know, and it's what's actually buildable today without
// coordinating an Azure AD app registration with F&W's IT first. That
// coordination is worth doing for real Entra ID login later (Noah's
// usual preference, and F&W likely already has this via Microsoft 365),
// this is the reasonable interim.
//
// Comparison logic runs inside Next.js middleware, which executes on the
// Edge runtime, not Node.js, on Vercel. Node's `crypto.timingSafeEqual`
// isn't available there (a real deploy would fail, not just warn, if
// this imported it), so it's written by hand from character codes
// instead, working identically in middleware, in a normal API route, and
// in a unit test.

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

function getAdminUsers(): { name: string; passcode: string }[] {
  const raw = process.env.ADMIN_USERS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex === -1) return null;
      const name = entry.slice(0, separatorIndex).trim();
      const passcode = entry.slice(separatorIndex + 1).trim();
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
