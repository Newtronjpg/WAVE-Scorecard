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
  // Resolved by the caller from the admin-editable setting. Absent means
  // fall back to the NOTIFY_EMAIL environment variable.
  recipients?: string[];
}

// Reads the Gmail configuration, or null when it isn't set up. Shared by
// both senders so "configured" means exactly the same thing for a normal
// notification and for a failure alert.
//
// Recipients are passed in by the caller rather than read from the
// environment here, because they now live in an admin-editable database
// setting. Keeping the database out of this module leaves it
// independently testable and usable from anywhere.
//
// An explicitly passed EMPTY list means "notifications are off" and must
// not fall through to NOTIFY_EMAIL; only an absent argument falls back.
export function resolveMailConfig(
  recipientsOverride?: string[]
): { user: string; pass: string; recipients: string[] } | null {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD;
  const recipients =
    recipientsOverride ?? parseRecipients(process.env.NOTIFY_EMAIL);
  if (!user || !pass || recipients.length === 0) return null;
  return { user, pass, recipients };
}

async function deliver(
  config: { user: string; pass: string; recipients: string[] },
  subject: string,
  text: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.user, pass: config.pass },
  });

  await withTimeout(
    transporter.sendMail({
      from: `WAVE Scorecard <${config.user}>`,
      to: config.recipients,
      subject,
      text,
    }),
    TIMEOUT_MS,
    "Gmail send"
  );
}

export async function sendSubmissionNotification(
  details: NotificationDetails
): Promise<{ sent: boolean; reason?: string }> {
  const config = resolveMailConfig(details.recipients);

  if (!config) {
    // Not configured. This is a normal, expected state (e.g. local dev,
    // or before Gmail credentials have been set), not an error.
    return { sent: false, reason: "not configured" };
  }

  try {
    const { prospectName, companyName, result } = details;

    const gapLines = result.gaps
      .map((g) => `${g.name}: ${g.score}/100`)
      .join("\n");

    await deliver(
      config,
      `${prospectName} (${companyName}) completed the WAVE Scorecard, ${result.overallScore}/100`,
      `${prospectName} at ${companyName} just finished the WAVE Scorecard.

Overall: ${result.overallScore}/100 (${result.band.label})

${gapLines}

Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)

Full submission and export: ${details.adminUrl}`
    );

    return { sent: true };
  } catch (e) {
    console.error("Failed to send submission notification email:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}

export interface PersistenceFailureDetails {
  prospectName: string;
  companyName: string;
  recipients?: string[];
  answers: Record<string, number>;
  result: ScoreResult;
  adminUrl: string;
  error: unknown;
}

// Builds the alert sent when a submission scored correctly but could NOT
// be written to the database.
//
// This email is not just a warning, it is the only surviving copy of that
// submission. The row was never inserted, so nothing in the database can
// recover it and no admin export will ever contain it. That is why the
// body carries every raw answer verbatim: a staff member can reconstruct
// the assessment by hand from this message alone. Kept separate from
// sending so the content is directly testable without SMTP.
export function buildPersistenceFailureAlert(details: PersistenceFailureDetails): {
  subject: string;
  text: string;
} {
  const { prospectName, companyName, answers, result, adminUrl, error } = details;

  const reason = error instanceof Error ? error.message : String(error);
  const answerLines = Object.entries(answers)
    .map(([id, rating]) => `  ${id}=${rating}`)
    .join("\n");

  const gapLines = result.gaps.map((g) => `  ${g.name}: ${g.score}/100`).join("\n");

  return {
    subject: `ACTION NEEDED, submission NOT SAVED: ${prospectName} (${companyName})`,
    text: `A prospect completed the WAVE Scorecard, but it could NOT be saved to
the database. They were shown their results as normal and do not know
anything went wrong.

THIS EMAIL IS THE ONLY COPY OF THIS SUBMISSION. It is not in the admin
table and it will not appear in the Excel export. Save it somewhere
before deleting this message.

Prospect: ${prospectName}
Company:  ${companyName}
When:     ${new Date().toISOString()}

Overall: ${result.overallScore}/100 (${result.band.label})
${gapLines}
Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)

Raw answers (question id = rating 1-5):
${answerLines}

Why it failed:
  ${reason}

The form is still collecting submissions and still losing them. Until
this is fixed, every further assessment is lost the same way.

Admin: ${adminUrl}`,
  };
}

// Alerts staff that a submission was lost. Mirrors the contract of
// sendSubmissionNotification: never throws, always reports what happened,
// so a failure to alert can never mask the original persistence failure
// or break the response to the person taking the assessment.
export async function sendPersistenceFailureAlert(
  details: PersistenceFailureDetails
): Promise<{ sent: boolean; reason?: string }> {
  const config = resolveMailConfig(details.recipients);
  const { subject, text } = buildPersistenceFailureAlert(details);

  if (!config) {
    // Deliberately loud. For a normal notification "not configured" is a
    // routine state; here it means a submission was just lost AND nobody
    // is going to be told, which is the exact silent-failure this whole
    // path exists to prevent.
    console.error(
      "[WAVE ALERT] Submission could not be saved AND no alert could be sent " +
        "(GMAIL_USER / GMAIL_APP_PASSWORD / NOTIFY_EMAIL are not configured). " +
        "The lost submission follows:\n" +
        text
    );
    return { sent: false, reason: "not configured" };
  }

  try {
    await deliver(config, subject, text);
    return { sent: true };
  } catch (e) {
    console.error(
      "[WAVE ALERT] Submission could not be saved AND the alert email failed to " +
        "send. The lost submission follows:\n" +
        text,
      e
    );
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
