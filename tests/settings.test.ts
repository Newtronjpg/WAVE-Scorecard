import { describe, it, expect } from "vitest";
import { validateRecipients } from "@/lib/settings";

// The recipient list is typed by a non-technical user into a web form,
// so a typo must be rejected with a message rather than silently
// dropped. Silently dropping one address out of two is the worst
// outcome: notifications appear to work while one person never hears
// anything.

describe("validateRecipients", () => {
  it("accepts a single address", () => {
    const result = validateRecipients("owner@example.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("owner@example.com");
  });

  it("accepts a comma-separated list", () => {
    const result = validateRecipients("owner@example.com, ben@firm.com");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("owner@example.com, ben@firm.com");
  });

  it("normalizes case and whitespace", () => {
    const result = validateRecipients("  Owner@Example.COM ,  Ben@Firm.com  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("owner@example.com, ben@firm.com");
  });

  it("accepts an empty value, meaning notifications are off", () => {
    const result = validateRecipients("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("");
  });

  it("accepts a whitespace-only value as empty", () => {
    const result = validateRecipients("   ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("");
  });

  it("rejects a value that is not an email address", () => {
    const result = validateRecipients("not-an-email");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not-an-email/);
  });

  it("rejects the whole list when one entry is malformed, naming the bad one", () => {
    // Rejecting the whole list is deliberate: partially saving would
    // leave the user believing both addresses were accepted.
    const result = validateRecipients("owner@example.com, oops");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/oops/);
  });

  it("ignores trailing commas and blank entries rather than failing", () => {
    const result = validateRecipients("owner@example.com, ,ben@firm.com,");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("owner@example.com, ben@firm.com");
  });

  it("rejects an address with no domain", () => {
    const result = validateRecipients("owner@");
    expect(result.ok).toBe(false);
  });

  it("rejects an address with spaces inside it", () => {
    const result = validateRecipients("owner name@example.com");
    expect(result.ok).toBe(false);
  });
});
