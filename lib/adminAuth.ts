// The assessment link itself is intentionally open (no login), per Noah:
// it's going to Ben first and isn't handling anything regulated yet. The
// admin view is different: it lists every submission, including whatever
// name/company a prospect entered. That gets a passcode, checked with a
// constant-time comparison so response time can't leak how many
// characters of the guess were correct.
//
// This runs inside Next.js middleware, which executes on the Edge
// runtime, not Node.js, on Vercel. Node's `crypto.timingSafeEqual` isn't
// available there (a real deploy would fail, not just warn, if this
// imported it, `next build` flagged exactly that during testing), so the
// comparison below is written by hand from character codes instead. It's
// a few more lines than `crypto.timingSafeEqual`, but it works
// identically in middleware, in a normal API route, and in a unit test,
// without caring which JS runtime it's executing in.

export const ADMIN_COOKIE_NAME = "wave_admin";

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

export function isValidPasscode(input: string): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    // Fail closed: if the env var isn't set, nothing is a valid passcode.
    // The alternative (treating a missing passcode as "no auth required")
    // is the kind of default that quietly ships an unlocked admin page.
    return false;
  }
  return timingSafeStringEqual(input, expected);
}
