import { describe, it, expect, afterEach } from "vitest";
import { resolveMailConfig } from "@/lib/email";

// Recipients now come from the database (an admin-editable setting) with
// the NOTIFY_EMAIL environment variable as a fallback. lib/email.ts must
// stay free of any database import so it remains independently testable,
// so the caller resolves recipients and passes them in.

const ORIGINAL_ENV = {
  GMAIL_USER: process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL,
};

function withCredentials() {
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "abcdefghijklmnop";
}

describe("resolveMailConfig", () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses explicitly passed recipients over the environment variable", () => {
    withCredentials();
    process.env.NOTIFY_EMAIL = "stale@example.com";

    const config = resolveMailConfig(["fresh@example.com"]);

    expect(config).not.toBeNull();
    expect(config?.recipients).toEqual(["fresh@example.com"]);
  });

  it("falls back to the environment variable when no recipients are passed", () => {
    withCredentials();
    process.env.NOTIFY_EMAIL = "fallback@example.com";

    const config = resolveMailConfig();

    expect(config?.recipients).toEqual(["fallback@example.com"]);
  });

  it("returns null when credentials are missing, whatever the recipients", () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;

    expect(resolveMailConfig(["someone@example.com"])).toBeNull();
  });

  it("returns null when an explicitly empty recipient list is passed", () => {
    // An admin who clears the field means "notifications off". That must
    // NOT silently fall through to the environment variable.
    withCredentials();
    process.env.NOTIFY_EMAIL = "fallback@example.com";

    expect(resolveMailConfig([])).toBeNull();
  });

  it("returns null when neither recipients nor the env var are set", () => {
    withCredentials();
    delete process.env.NOTIFY_EMAIL;

    expect(resolveMailConfig()).toBeNull();
  });
});
