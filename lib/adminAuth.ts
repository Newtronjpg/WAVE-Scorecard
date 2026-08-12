// The assessment link itself is intentionally open (no login): it isn't
// handling anything regulated. The admin view is different: it lists
// every submission, including whatever name/company a prospect entered,
// so it's passcode-gated.
//
// Because several staff members need admin access, this is deliberately
// NOT a single shared secret. Each person gets their own named passcode
// in ADMIN_USERS, a comma-separated "Name:passcode" list, e.g.
// ADMIN_USERS="Alex:first-passcode,Sam:second-passcode". Benefits over
// one shared string: the app can show who's logged in, and revoking one
// person's access later means deleting their entry, not changing the
// passcode for everyone else too. It's still not full SSO, no
// centralized identity provider, no per-person audit log beyond "who's
// currently logged in", but it's a real step up from one secret the
// whole team knows, and it's what's buildable without first coordinating
// an Azure AD app registration with the firm's IT. That coordination is
// worth doing for real Entra ID login later, if the firm already has
// Microsoft 365; this is the reasonable interim.
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

// Defends against the most common way ADMIN_USERS gets mis-entered in a
// hosting dashboard: surrounding quotes and stray whitespace. A .env file
// needs the quotes (`ADMIN_USERS="Name:pass"`) and dotenv strips them,
// but pasting that same quoted string into Vercel's UI stores the quotes
// literally, which would otherwise make the passcode `pass"` (with a
// trailing quote) and silently reject the clean value forever. Trimming
// and stripping wrapping quotes on both the name and the passcode makes
// either form work. A passcode intentionally beginning or ending with a
// quote is not a realistic case and not worth preserving over this.
function clean(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "").trim();
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
