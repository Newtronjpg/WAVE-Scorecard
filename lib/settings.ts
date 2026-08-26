import { db } from "./db";
import { normalizeEmail, parseRecipients } from "./email";

// Editable settings, stored one row per key. Today there's exactly one:
// the notification recipient list, in the database rather than an env var
// so a staff member can change it without a redeploy. NOTIFY_EMAIL remains
// the fallback when no row has been saved.

export const NOTIFY_EMAIL_KEY = "notify_email";

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

// Deliberately conservative: no spaces, exactly one @, a dot-bearing
// domain. This validates addresses typed into a form by hand, where the
// realistic failure is a typo, not an exotic-but-legal RFC 5322 address.
//
// Plain string checks rather than a single regex: a pattern like
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ lets the two [^\s@]+ groups and the
// literal "." re-split the same input many ways when the match fails,
// which is polynomial-time backtracking on adversarial input (e.g. many
// repeated "!." segments with no valid ending).
function isPlausibleEmail(value: string): boolean {
  if (value.length === 0 || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

// Validates a comma-separated recipient list and returns it normalized.
//
// An empty value is legal and means notifications are off. A malformed
// entry rejects the WHOLE list rather than being dropped: silently
// saving one of two addresses would leave the user believing both were
// accepted, and the missing person would simply never be notified.
export function validateRecipients(raw: string): ValidationResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, value: "" };

  const entries = trimmed
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (entries.length === 0) return { ok: true, value: "" };

  for (const entry of entries) {
    if (!isPlausibleEmail(entry)) {
      return { ok: false, error: `"${entry}" is not a valid email address.` };
    }
  }

  return { ok: true, value: entries.map(normalizeEmail).join(", ") };
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch (e) {
    // A settings read must never take down the page that uses it. Falling
    // back to the environment variable is the correct degraded behaviour.
    console.error('Failed to read setting "%s":', key, e);
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

// The saved row wins; NOTIFY_EMAIL is the fallback when nothing has been
// saved yet. A saved empty string is meaningful, it means "notifications
// off", and must NOT fall through to the environment variable.
export async function getNotifyRecipients(): Promise<string[]> {
  const stored = await getSetting(NOTIFY_EMAIL_KEY);
  if (stored !== null) return parseRecipients(stored);
  return parseRecipients(process.env.NOTIFY_EMAIL);
}

// The raw string as saved, for display in the admin form. Falls back to
// the environment variable so the field shows what is actually in effect
// rather than appearing empty on a deployment that only set the env var.
export async function getNotifyRecipientsRaw(): Promise<string> {
  const stored = await getSetting(NOTIFY_EMAIL_KEY);
  if (stored !== null) return stored;
  return (process.env.NOTIFY_EMAIL ?? "").trim();
}

export async function setNotifyRecipients(value: string): Promise<void> {
  await setSetting(NOTIFY_EMAIL_KEY, value);
}
