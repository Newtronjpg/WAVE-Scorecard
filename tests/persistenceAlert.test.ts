import { describe, it, expect, afterEach } from "vitest";
import {
  buildPersistenceFailureAlert,
  sendPersistenceFailureAlert,
} from "@/lib/email";
import type { ScoreResult } from "@/lib/scoring";

// A submission that failed to persist is the ONLY copy of that data --
// the row was never written, so nothing in the database can recover it.
// These tests pin the two properties that matter: staff find out that it
// happened, and the alert carries enough raw detail to reconstruct the
// lost submission by hand.

const ORIGINAL_ENV = {
  GMAIL_USER: process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL,
};

function fakeResult(): ScoreResult {
  return {
    overallScore: 58,
    band: { label: "Meaningful gaps", floor: 40, description: "test" },
    gaps: [
      { gap: "wealth", name: "Wealth gap", score: 50, gapToClose: 50 },
      { gap: "accounting", name: "Accounting gap", score: 75, gapToClose: 25 },
      { gap: "value", name: "Value gap", score: 50, gapToClose: 50 },
      { gap: "earnings", name: "Earnings gap", score: 57, gapToClose: 43 },
    ],
    widestGap: { gap: "wealth", name: "Wealth gap", score: 50, gapToClose: 50 },
  };
}

function fakeDetails() {
  return {
    prospectName: "Jane Owner",
    companyName: "Acme Fabrication",
    answers: { W1: 4, W2: 2, A1: 5, E7: 1 },
    result: fakeResult(),
    adminUrl: "https://wave.example.com/admin",
    error: new Error(
      "The table `public.submissions` does not exist in the current database."
    ),
  };
}

describe("buildPersistenceFailureAlert", () => {
  it("marks the subject as a failure so it is not mistaken for a normal submission", () => {
    const { subject } = buildPersistenceFailureAlert(fakeDetails());
    expect(subject).toMatch(/not saved/i);
  });

  it("names the prospect and company in the subject", () => {
    const { subject } = buildPersistenceFailureAlert(fakeDetails());
    expect(subject).toContain("Jane Owner");
    expect(subject).toContain("Acme Fabrication");
  });

  it("includes every raw answer so the lost submission can be reconstructed", () => {
    // This is the property that makes the alert a recovery mechanism
    // rather than just a warning. If an answer is missing here, that
    // answer is gone for good.
    const { text } = buildPersistenceFailureAlert(fakeDetails());
    expect(text).toContain("W1=4");
    expect(text).toContain("W2=2");
    expect(text).toContain("A1=5");
    expect(text).toContain("E7=1");
  });

  it("includes the underlying error so the cause is diagnosable from the alert", () => {
    const { text } = buildPersistenceFailureAlert(fakeDetails());
    expect(text).toContain("public.submissions");
  });

  it("includes the computed scores", () => {
    const { text } = buildPersistenceFailureAlert(fakeDetails());
    expect(text).toContain("58");
    expect(text).toContain("Meaningful gaps");
  });

  it("handles a non-Error thrown value without crashing", () => {
    const { text } = buildPersistenceFailureAlert({
      ...fakeDetails(),
      error: "connection refused",
    });
    expect(text).toContain("connection refused");
  });

  it("still lists answers when the answer map is empty", () => {
    const { text } = buildPersistenceFailureAlert({
      ...fakeDetails(),
      answers: {},
    });
    expect(typeof text).toBe("string");
    expect(text).toContain("Jane Owner");
  });

  it("does not claim the respondent saw a normal result when there was no score to show them", () => {
    // This alert's prose was written for db.submission.create failing
    // after scoring succeeded, where the respondent's browser genuinely
    // shows a normal results screen. It must not get reused verbatim for
    // the other failure mode -- the question-set version itself couldn't
    // be resolved, so `result` is absent -- since that respondent saw an
    // error and was told to retry.
    const { text } = buildPersistenceFailureAlert({
      ...fakeDetails(),
      result: undefined,
    });
    expect(text).not.toMatch(/shown their results as normal/i);
    expect(text).not.toMatch(/every further assessment is lost the same way/i);
  });

  it("still claims the respondent saw a normal result when a real score exists", () => {
    // The other half of I-1: the ORIGINAL failure mode (db write failed
    // after scoring succeeded) must keep its accurate prose, not lose it
    // to the fix for the other branch.
    const { text } = buildPersistenceFailureAlert(fakeDetails());
    expect(text).toMatch(/shown their results as normal/i);
  });
});

describe("sendPersistenceFailureAlert", () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports that it could not alert when Gmail is unconfigured", async () => {
    // Critical: an unconfigured alerter must not silently claim success.
    // Production currently has no GMAIL_* vars, so this is the live path.
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.NOTIFY_EMAIL;

    const outcome = await sendPersistenceFailureAlert(fakeDetails());

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toBe("not configured");
  });

  it("does not throw when unconfigured, so it cannot mask the original failure", async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.NOTIFY_EMAIL;

    await expect(sendPersistenceFailureAlert(fakeDetails())).resolves.toBeDefined();
  });
});
