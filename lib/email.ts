import nodemailer from "nodemailer";
import type { ScoreResult } from "./scoring";

// Notifies staff by email when a client finishes the assessment, over
// Gmail's SMTP server using an App Password (GMAIL_USER, GMAIL_APP_PASSWORD).
//
// Failure here is non-fatal and bounded: a submission is already scored
// and saved by the time this runs, so a slow or hung SMTP connection must
// not delay the results the respondent is waiting on. Without a timeout,
// a hung network call blocks the whole response indefinitely -- observed
// once during testing, where a real submission hung until manually
// interrupted. TIMEOUT_MS bounds the worst case to a few seconds.

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

// Defaults to the submitting request's origin, which is correct on a real
// deploy but depends on proxy headers being passed through faithfully.
// NEXT_PUBLIC_SITE_URL pins it explicitly instead. A bare host is assumed
// https; anything unparseable falls back to the request origin.
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

// Renders the respondent's optional per-question context, or "" when they
// left none, so a submission without comments produces a body byte-for-byte
// identical to the one this app sent before comments existed.
function commentSection(comments: Record<string, string> | undefined): string {
  const entries = Object.entries(comments ?? {}).filter(
    ([, text]) => text.trim().length > 0
  );
  if (entries.length === 0) return "";
  const noun = entries.length === 1 ? "question" : "questions";
  return `
Context the respondent added on ${entries.length} ${noun}:
${entries.map(([id, text]) => `  ${id}: ${text.trim()}`).join("\n")}
`;
}

export interface NotificationDetails {
  prospectName: string;
  companyName: string;
  // Collected on the landing page. Optional on the type so a caller that
  // predates these fields still compiles; rendered only when present.
  email?: string;
  industry?: string;
  result: ScoreResult;
  // Optional free text the respondent attached to individual questions,
  // keyed by question id. Absent or empty renders nothing at all.
  comments?: Record<string, string>;
  adminUrl: string;
  // Resolved by the caller from the admin-editable setting. Absent means
  // fall back to the NOTIFY_EMAIL environment variable.
  recipients?: string[];
}

// Reads the Gmail configuration, or null when it isn't set up. Shared by
// both senders so "configured" means the same thing everywhere.
//
// Recipients are passed in by the caller (they live in an admin-editable
// setting) rather than read from the environment here, keeping this
// module database-free and independently testable. An explicitly passed
// empty list means "notifications are off"; only an absent argument falls
// back to NOTIFY_EMAIL.
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
    const comments = commentSection(details.comments);
    const contact = [
      details.email ? `Email:    ${details.email}` : "",
      details.industry ? `Industry: ${details.industry}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const gapLines = result.gaps
      .map((g) => `${g.name}: ${g.score}/100`)
      .join("\n");

    await deliver(
      config,
      `${prospectName} (${companyName}) completed the WAVE Scorecard, ${result.overallScore}/100`,
      `${prospectName} at ${companyName} just finished the WAVE Scorecard.
${contact ? `\n${contact}\n` : ""}
Overall: ${result.overallScore}/100 (${result.band.label})

${gapLines}

Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)
${comments}
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
  email?: string;
  industry?: string;
  // Optional per-question context. On this path the email is the only
  // surviving copy of the submission, so the respondent's own words have
  // to travel with the ratings or they are gone.
  comments?: Record<string, string>;
  // Optional: absent when there is no score to report, e.g. the
  // question-set version this run answered could not be resolved at all
  // (app/api/submit/route.ts), so scoreAssessment was never called.
  // sendSubmissionNotification is untouched by this -- a routine
  // notification always has a real result.
  result?: ScoreResult;
  adminUrl: string;
  error: unknown;
}

// Builds the alert for a submission that scored correctly but couldn't be
// written to the database. This email is the only surviving copy -- the
// row was never inserted -- so the body carries every raw answer verbatim.
// Kept separate from sending so the content is testable without SMTP.
export function buildPersistenceFailureAlert(details: PersistenceFailureDetails): {
  subject: string;
  text: string;
} {
  const { prospectName, companyName, answers, result, adminUrl, error } = details;
  const comments = commentSection(details.comments);

  const reason = error instanceof Error ? error.message : String(error);
  const answerLines = Object.entries(answers)
    .map(([id, rating]) => `  ${id}=${rating}`)
    .join("\n");

  // `result` is absent when the question-set version couldn't be resolved
  // at all, so scoreAssessment was never called -- say plainly that no
  // score exists rather than fabricate one.
  const scoreSection = result
    ? `Overall: ${result.overallScore}/100 (${result.band.label})
${result.gaps.map((g) => `  ${g.name}: ${g.score}/100`).join("\n")}
Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)`
    : `Score: not available (the question set for this submission's version could not be resolved)`;

  // Two failure modes need different wording: db.submission.create
  // failing after scoring succeeded (the respondent sees a normal results
  // screen) versus the version failing to resolve at all (the respondent
  // saw an error and was told to retry).
  const respondentAwareness = result
    ? "They were shown their results as normal and do not know anything went wrong."
    : "They saw an error and were told their answers were not lost and to try again -- they may not know whether a retry has since succeeded.";
  const outageWarning = result
    ? "The form is still collecting submissions and still losing them. Until\nthis is fixed, every further assessment is lost the same way."
    : "This can be a one-off blip (a slow read, a cold start) rather than an\nongoing problem -- but if this keeps happening, the question-set store\nitself needs attention.";

  return {
    subject: `ACTION NEEDED, submission NOT SAVED: ${prospectName} (${companyName})`,
    text: `A prospect completed the WAVE Scorecard, but it could NOT be saved to
the database. ${respondentAwareness}

THIS EMAIL IS THE ONLY COPY OF THIS SUBMISSION. It is not in the admin
table and it will not appear in the Excel export. Save it somewhere
before deleting this message.

Prospect: ${prospectName}
Company:  ${companyName}${details.email ? `\nEmail:    ${details.email}` : ""}${
      details.industry ? `\nIndustry: ${details.industry}` : ""
    }
When:     ${new Date().toISOString()}

${scoreSection}

Raw answers (question id = rating):
${answerLines}
${comments}
Why it failed:
  ${reason}

${outageWarning}

Admin: ${adminUrl}`,
  };
}

export interface FollowUpRequestDetails {
  prospectName: string;
  companyName: string;
  email?: string;
  industry?: string;
  overallScore: number;
  readinessBand: string;
  adminUrl: string;
  recipients?: string[];
}

// Builds the "they want to talk" email. Kept separate from sending so the
// content is testable without SMTP, like the other two.
//
// This is the only signal staff get that someone opted in: the submission
// notification is sent before the results page even renders the question.
export function buildFollowUpRequest(details: FollowUpRequestDetails): {
  subject: string;
  text: string;
} {
  const { prospectName, companyName, overallScore, readinessBand } = details;
  const contact = [
    details.email ? `Email:    ${details.email}` : "",
    details.industry ? `Industry: ${details.industry}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `${prospectName} (${companyName}) wants a conversation`,
    text: `${prospectName} at ${companyName} finished the WAVE Scorecard and
asked to discuss the results with someone from the team.

They have already been told someone will reach out to find a convenient
time, so this is a commitment already made on our behalf.

Score:    ${overallScore}/100 (${readinessBand})
${contact}

Full submission and export: ${details.adminUrl}`,
  };
}

// Never throws, for the same reason the other senders don't: the answer
// is already recorded, and a mail failure must not surface to the person
// who just asked to be contacted.
export async function sendFollowUpRequest(
  details: FollowUpRequestDetails
): Promise<{ sent: boolean; reason?: string }> {
  const config = resolveMailConfig(details.recipients);
  if (!config) return { sent: false, reason: "not configured" };

  try {
    const { subject, text } = buildFollowUpRequest(details);
    await deliver(config, subject, text);
    return { sent: true };
  } catch (e) {
    console.error("Failed to send follow-up request email:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
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
        "The lost submission follows:\n%s",
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
        "send. The lost submission follows:\n%s",
      text,
      e
    );
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
