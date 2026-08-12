import { Resend } from "resend";
import type { ScoreResult } from "./scoring";

// Notifies staff by email when a client finishes the assessment.
//
// Sends from Resend's shared onboarding@resend.dev address, which works
// with zero setup but has one hard restriction: it can only deliver to
// the exact email address the Resend account was created with (a
// platform anti-abuse rule, not something this code can work around).
// That's fine to start: NOTIFY_EMAIL should just be your own address.
// Once the firm's domain has DNS access sorted and gets verified in
// Resend, change RESEND_FROM to a real address on that domain and this
// can notify anyone, no code changes needed, both are plain env vars.
//
// "Exact address" turned out to mean exact, including case: Resend
// rejected Example.User@gmail.com against an account created as
// example.user@gmail.com, even though Gmail itself treats those as the
// identical inbox. normalizeEmail() below fixes that at the source, so
// how anyone happens to type NOTIFY_EMAIL (or a future admin's address)
// in .env never matters again.
//
// Failure here is deliberately non-fatal, AND deliberately bounded. A
// submission has already been scored and saved by the time this runs
// (see app/api/submit/route.ts); if the notification fails OR simply
// takes too long (a slow network path to Resend, a firewall silently
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
  const apiKey = process.env.RESEND_API_KEY;
  const rawTo = process.env.NOTIFY_EMAIL;

  if (!apiKey || !rawTo) {
    // Not configured. This is a normal, expected state (e.g. local dev,
    // or before a Resend account has been set up), not an error.
    return { sent: false, reason: "not configured" };
  }
  const to = normalizeEmail(rawTo);

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM || "WAVE Scorecard <onboarding@resend.dev>";
    const { prospectName, companyName, result } = details;

    const gapLines = result.gaps
      .map((g) => `${g.name}: ${g.score}/100`)
      .join("\n");

    const { error } = await withTimeout(
      resend.emails.send({
        from,
        to,
        subject: `${prospectName} (${companyName}) completed the WAVE Scorecard, ${result.overallScore}/100`,
        text: `${prospectName} at ${companyName} just finished the WAVE Scorecard.

Overall: ${result.overallScore}/100 (${result.band.label})

${gapLines}

Widest gap: ${result.widestGap.name} (${result.widestGap.score}/100)

Full submission and export: ${details.adminUrl}`,
      }),
      TIMEOUT_MS,
      "Resend send"
    );

    if (error) {
      console.error("Resend returned an error sending submission notification:", error);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (e) {
    console.error("Failed to send submission notification email:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "unknown error" };
  }
}
