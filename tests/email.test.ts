import { describe, it, expect, afterEach } from "vitest";
import { sendSubmissionNotification, withTimeout, normalizeEmail } from "@/lib/email";
import type { ScoreResult } from "@/lib/scoring";

const ORIGINAL_ENV = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
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

describe("normalizeEmail", () => {
  it("lowercases mixed-case addresses", () => {
    // The exact bug found in the field: Resend rejected
    // "Example.User@gmail.com" as not matching the account's address,
    // even though Gmail itself treats it identically to
    // "example.user@gmail.com". Resend's check is apparently an exact
    // string match, not case-insensitive, so this has to be normalized
    // before it ever reaches them.
    expect(normalizeEmail("Example.User@gmail.com")).toBe("example.user@gmail.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alex@example.com  ")).toBe("alex@example.com");
  });

  it("is a no-op on an already-normalized address", () => {
    expect(normalizeEmail("sam@example.com")).toBe("sam@example.com");
  });
});

describe("withTimeout", () => {
  it("resolves normally when the promise finishes well within the limit", async () => {
    const fast = new Promise((resolve) => setTimeout(() => resolve("done"), 10));
    await expect(withTimeout(fast, 1000, "test")).resolves.toBe("done");
  });

  it("rejects on schedule instead of hanging when the promise never resolves", async () => {
    // This is the exact failure mode found in the field: a network call
    // that neither resolves nor rejects, previously left `await` stuck
    // forever. never-resolving promise + a short timeout proves the race
    // actually cuts it off rather than waiting indefinitely.
    const hangsForever = new Promise(() => {
      /* deliberately never settles, simulating a stuck network call */
    });
    await expect(withTimeout(hangsForever, 50, "stuck call")).rejects.toThrow(
      /stuck call timed out after 50ms/
    );
  });

  it("propagates the original rejection reason when the promise fails before the timeout", async () => {
    const failsFast = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("real failure")), 10)
    );
    await expect(withTimeout(failsFast, 1000, "test")).rejects.toThrow("real failure");
  });
});

describe("sendSubmissionNotification", () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("does not attempt to send, and does not throw, when unconfigured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFY_EMAIL;

    const outcome = await sendSubmissionNotification({
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      result: fakeResult(),
      adminUrl: "http://localhost:3000/admin",
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toBe("not configured");
  });

  it("does not attempt to send when only the API key is set but no recipient", async () => {
    process.env.RESEND_API_KEY = "re_fake_key_for_testing";
    delete process.env.NOTIFY_EMAIL;

    const outcome = await sendSubmissionNotification({
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      result: fakeResult(),
      adminUrl: "http://localhost:3000/admin",
    });

    expect(outcome.sent).toBe(false);
  });

  it("never throws even with a garbage API key (fails gracefully, caller unaffected)", async () => {
    process.env.RESEND_API_KEY = "not-a-real-key";
    process.env.NOTIFY_EMAIL = "test@example.com";

    await expect(
      sendSubmissionNotification({
        prospectName: "Jane Owner",
        companyName: "Acme Fabrication",
        result: fakeResult(),
        adminUrl: "http://localhost:3000/admin",
      })
    ).resolves.toBeDefined();
  });
});
