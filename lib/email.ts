import nodemailer from "nodemailer";
import type { ScoreResult } from "./scoring";

// Notifies staff by email when a client finishes the assessment.
//
// Sends through Gmail's SMTP server using an App Password (a 16-character
// credential generated in the sending account's Google security
// settings, distinct from the account's real password and revocable on
// its own). Two env vars carry the credential: GMAIL_USER (the sending
// address) and GMAIL_APP_PASSWORD. Unlike a shared transactional-email
// sandbox, this can deliver to ANY recipient with no domain-verification
// step, so NOTIFY_EMAIL can be any address, or several.
//
// NOTIFY_EMAIL accepts a comma-separated list, so more than one person
// (e.g. the owner plus a partner) can be notified. Each address is
// trimmed and lowercased; blank entries are dropped.
//
// Failure here is deliberately non-fatal, AND deliberately bounded. A
// submission has already been scored and saved by the time this runs
// (see app/api/submit/route.ts); if the notification fails OR simply
// takes too long (a slow network path to Gmail, a firewall silently
// dropping the connection, anything), the person taking the assessment
// still needs to see their results promptly. Without a timeout, an
// `await` on a hung network call blocks the entire response
// indefinitely, found exactly this way during testing: a real submission
// hung until it had to be manually interrupted. TIMEOUT_MS bounds the
// worst case to a few seconds instead of forever.

const TIMEOUT_MS = 8000;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

// Parses NOTIFY_EMAIL into a clean list of recipients. Accepts a single
// address or a comma-separated list; trims and lowercases each; drops
// blanks. Returns [] when nothing usable is configured.
export function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

// The admin link in the notification email has to be clickable from
// wherever the recipient reads their mail, so it can never be a
// localhost URL. By default it's derived from the origin of the request
// that submitted the assessment, which is correct on a real deploy but
// depends on proxy headers being passed through faithfully. Setting
// NEXT_PUBLIC_SITE_URL pins it explicitly and removes that dependency.
// A bare host ("example.com") is accepted and assumed https; anything
// unparseable falls back to the request origin rather than dropping the
// link out of the email entirely.
export function resolveAdminUrl(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    try {
      return new URL("/admin", base).toString();
    } catch {
      // Fall through to the request origin below.
    }
  }
  return new URL("/admin", requestOrigin).toString();
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export interface NotificationDetails {
  prospectName: string;
  companyName: string;
  result: ScoreResult;
  adminUrl: string;
}

export async function sendSubmissionNotification(
  details: NotificationDetails
): Promise<{ sent: boolean; reason?: string }> {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD;
  const recipients = parseRecipients(process.env.NOTIFY_EMAIL);

  if (!user || !pass || recipients.length === 0) {
    // Not configured. This is a normal, expected state (e.g. local dev,
    // or before Gmail credentials have been set), not an error.
    return { sent: false, reason: "not configured" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });

    // A friendly From name is optional; the address must be the
    // authenticated Gmail account (or an alias Gmail is configured to
    // "send mail as"), so it's always derived from GMAIL_USER.
    const from = `WAVE Scorecard <${user}>`;
    const { prospectName, companyName, result } = details;

    const gapLines = result.gaps
      .map((g) => `${g.name}: ${g.score}/100`)
      .join("\n");

    await withTimeout(
      transporter.sendMail({
        from,
        to: recipients,
        subject: `${prospectName} (${companyName}) completed the WAVE Scorecard, ${result.overallScore}/100`,
        text: `${prospectName} at ${companyName} just finished the WAVE Scorecard.

Overall: ${result.overallScore}/100 (${result.band.label})

${gapLines}

Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)

Full submission and export: ${details.adminUrl}`,
      }),
      TIMEOUT_MS,
      "Gmail send"
    );

    return { sent: true };
  } catch (e) {
    console.error("Failed to send submission notification email:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
