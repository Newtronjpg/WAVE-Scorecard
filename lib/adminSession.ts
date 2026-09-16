// Signed, expiring admin sessions.
//
// WHAT THIS REPLACES, and why it mattered: the cookie used to carry the staff
// member's passcode verbatim, and every request re-checked that passcode
// against ADMIN_USERS. Two consequences.
//
//   The cookie WAS the password. httpOnly keeps page JavaScript away from it,
//   but it is still readable in devtools, in a browser profile on disk, in any
//   backup of one, and by anything that can reach the cookie jar. Whoever read
//   it held the actual credential, not a session -- good on a different device,
//   for a different person, indefinitely.
//
//   Nothing ever expired. The cookie's 14-day maxAge is a hint to the browser
//   and nothing more; the SERVER applied no time limit at all, so a copied
//   value kept working until somebody thought to change ADMIN_USERS, which
//   changes it for everyone at once.
//
// So the cookie now carries a token that proves a login happened, names who
// logged in, and states when it stops being valid -- signed, so it cannot be
// forged or edited, and useless on its own for logging in again.
//
// Runs in middleware on the Edge runtime, so this uses Web Crypto (available
// there) rather than node:crypto (not).

const ENCODER = new TextEncoder();

// Absolute, not sliding. A sliding window would let one login be kept alive
// forever by an attacker who has the cookie and simply keeps using it, which
// is the property we set out to remove.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // twelve hours

export interface SessionPayload {
  /** Which staff member. Checked against ADMIN_USERS on every request. */
  name: string;
  /** Issued at, epoch ms. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns a Uint8Array backed by a plain ArrayBuffer, which is what Web
// Crypto's BufferSource wants -- a bare Uint8Array can be backed by a
// SharedArrayBuffer as far as the type system knows.
function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The signing key.
//
// ADMIN_SESSION_SECRET if it is set. If it is not, the key is derived from
// ADMIN_USERS instead, so this works with no new configuration rather than
// failing open or refusing to boot. That derivation has a useful property:
// changing any passcode changes the key, which invalidates every outstanding
// session. Revoking someone therefore also logs them out, instead of leaving
// them holding a valid token until it expires.
async function signingKey(): Promise<CryptoKey | null> {
  const secret = (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  const material = secret || (process.env.ADMIN_USERS ?? "").trim();
  // No secret AND no users configured means nobody can log in anyway; fail
  // closed rather than signing with an empty key.
  if (!material) return null;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    ENCODER.encode(`wave-admin-session:${material}`)
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Mints a token for a staff member who has just proved their passcode. */
export async function createSessionToken(
  name: string,
  now: number = Date.now()
): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;

  const payload: SessionPayload = { name, iat: now, exp: now + SESSION_TTL_MS };
  const body = b64urlEncode(ENCODER.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, ENCODER.encode(body));
  return `v1.${body}.${b64urlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies a token and returns its payload, or null.
 *
 * Null for every failure without distinguishing them: a forged signature, an
 * expired session and a malformed string are all just "not logged in", and
 * saying which would help someone probing.
 *
 * Signature is checked BEFORE expiry, because `exp` is only meaningful once
 * the payload is known to be ours.
 */
export async function verifySessionToken(
  token: string | undefined,
  now: number = Date.now()
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, body, signature] = parts;

  const key = await signingKey();
  if (!key) return null;

  let valid = false;
  try {
    // crypto.subtle.verify is constant-time; never compare signatures with ===.
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(signature),
      ENCODER.encode(body)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (
    typeof payload?.name !== "string" ||
    typeof payload?.exp !== "number" ||
    typeof payload?.iat !== "number"
  ) {
    return null;
  }
  if (now >= payload.exp) return null;
  // A token claiming to be issued in the future is either a forgery attempt
  // against a leaked key or a badly wrong clock. Neither should be honoured.
  if (payload.iat > now + 60_000) return null;
  // Belt and braces: a token whose stated lifetime exceeds the policy cannot
  // have been minted by this code, whatever its signature says.
  if (payload.exp - payload.iat > SESSION_TTL_MS) return null;

  return payload;
}
