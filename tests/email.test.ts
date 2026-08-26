import { describe, it, expect, afterEach } from "vitest";
import {
  sendSubmissionNotification,
  withTimeout,
  normalizeEmail,
  parseRecipients,
  resolveAdminUrl,
} from "@/lib/email";
import type { ScoreResult } from "@/lib/scoring";

const ORIGINAL_ENV = {
  GMAIL_USER: process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL,
};

function fakeResult(): ScoreResult {
  return {
    overallScore: 58,
    band: { label: "Good", floor: 50, description: "test" },
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
    expect(normalizeEmail("Example.User@gmail.com")).toBe("example.user@gmail.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alex@example.com  ")).toBe("alex@example.com");
  });

  it("is a no-op on an already-normalized address", () => {
    expect(normalizeEmail("sam@example.com")).toBe("sam@example.com");
  });
});

describe("parseRecipients", () => {
  it("returns an empty list for undefined, empty, or whitespace input", () => {
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
    expect(parseRecipients(",, ,")).toEqual([]);
  });

  it("parses a single address", () => {
    expect(parseRecipients("owner@example.com")).toEqual(["owner@example.com"]);
  });

  it("splits, trims, and lowercases a comma-separated list", () => {
    expect(parseRecipients("Owner@Example.com, Dana@Firm.com")).toEqual([
      "owner@example.com",
      "dana@firm.com",
    ]);
  });

  it("drops blank entries from a ragged list", () => {
    expect(parseRecipients("owner@example.com, ,dana@firm.com,")).toEqual([
      "owner@example.com",
      "dana@firm.com",
    ]);
  });
});

describe("resolveAdminUrl", () => {
  const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (ORIGINAL_SITE_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
    }
  });

  it("falls back to the request origin when NEXT_PUBLIC_SITE_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(resolveAdminUrl("https://wave.example.com")).toBe(
      "https://wave.example.com/admin"
    );
  });

  it("prefers NEXT_PUBLIC_SITE_URL over the request origin", () => {
    // The whole point of the override: a request that arrived as
    // localhost (or via a proxy that rewrote the host) must still
    // produce a link the email recipient can actually click.
    process.env.NEXT_PUBLIC_SITE_URL = "https://wave.example.com";
    expect(resolveAdminUrl("http://localhost:3000")).toBe(
      "https://wave.example.com/admin"
    );
  });

  it("assumes https for a bare host with no scheme", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "wave.example.com";
    expect(resolveAdminUrl("http://localhost:3000")).toBe(
      "https://wave.example.com/admin"
    );
  });

  it("ignores a trailing slash on the configured URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://wave.example.com/";
    expect(resolveAdminUrl("http://localhost:3000")).toBe(
      "https://wave.example.com/admin"
    );
  });

  it("treats an empty or whitespace-only value as unset", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(resolveAdminUrl("https://wave.example.com")).toBe(
      "https://wave.example.com/admin"
    );
  });

  it("falls back to the request origin when the configured URL is unparseable", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://";
    expect(resolveAdminUrl("https://wave.example.com")).toBe(
      "https://wave.example.com/admin"
    );
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
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
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

  it("does not attempt to send when credentials are set but no recipient", async () => {
    process.env.GMAIL_USER = "sender@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
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

  it("does not attempt to send when a recipient is set but credentials are missing", async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    process.env.NOTIFY_EMAIL = "owner@example.com";

    const outcome = await sendSubmissionNotification({
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      result: fakeResult(),
      adminUrl: "http://localhost:3000/admin",
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toBe("not configured");
  });

  it("never throws even with bad credentials (fails gracefully, caller unaffected)", async () => {
    // Fully configured but the credentials are wrong and/or the SMTP
    // host is unreachable from the test environment. The call must still
    // resolve (never reject), so a submission response is never blocked
    // by a mail failure. Bounded by TIMEOUT_MS so it can't hang the run.
    process.env.GMAIL_USER = "sender@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "not-a-real-app-password";
    process.env.NOTIFY_EMAIL = "test@example.com";

    const outcome = await sendSubmissionNotification({
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      result: fakeResult(),
      adminUrl: "http://localhost:3000/admin",
    });

    expect(outcome).toBeDefined();
    expect(outcome.sent).toBe(false);
  }, 15000);
});

describe("the follow-up answer in the completion email", () => {
  function details(followUpInterest: boolean | null | undefined) {
    return {
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      email: "jane@acme.com",
      industry: "Manufacturing",
      followUpInterest,
      result: fakeResult(),
      adminUrl: "https://wave.example.com/admin",
      answers: { W1: 4 },
      error: new Error("db down"),
    };
  }

  it("calls out a yes, and says the commitment is already made", async () => {
    const { buildPersistenceFailureAlert } = await import("@/lib/email");
    const { text } = buildPersistenceFailureAlert(details(true));
    expect(text).toContain("WANTS A CONVERSATION");
    expect(text).toContain("already been told someone will reach out");
  });

  it("records an explicit no without shouting about it", async () => {
    const { buildPersistenceFailureAlert } = await import("@/lib/email");
    const { text } = buildPersistenceFailureAlert(details(false));
    expect(text).toContain("not at this time");
    expect(text).not.toContain("WANTS A CONVERSATION");
  });

  it("says nothing at all when they never answered", async () => {
    // Null is not a no; the email must not imply one.
    const { buildPersistenceFailureAlert } = await import("@/lib/email");
    for (const value of [null, undefined]) {
      const { text } = buildPersistenceFailureAlert(details(value));
      expect(text).not.toContain("WANTS A CONVERSATION");
      expect(text).not.toContain("not at this time");
      expect(text).not.toContain("undefined");
    }
  });
});
