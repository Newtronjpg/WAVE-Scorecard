import { describe, it, expect } from "vitest";
import {
  INDUSTRY_OPTIONS,
  MAX_EMAIL_LENGTH,
  isPlausibleEmail,
  isValidIndustry,
  resolveIndustry,
} from "../lib/contact";

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of [
      "jane@acme.com",
      "jane.owner+wave@acme.co.uk",
      "j@a.io",
      "JANE@ACME.COM",
    ]) {
      expect(isPlausibleEmail(ok)).toBe(true);
    }
  });

  it("rejects the realistic typos", () => {
    for (const bad of [
      "",
      "jane",
      "jane@",
      "@acme.com",
      "jane@acme",
      "jane@acme.",
      "jane@.com",
      "jane @acme.com",
      "jane@acme .com",
      "jane@@acme.com",
      "jane@one@two.com",
    ]) {
      expect(isPlausibleEmail(bad)).toBe(false);
    }
  });

  it("rejects anything longer than the field allows", () => {
    expect(isPlausibleEmail("a".repeat(MAX_EMAIL_LENGTH) + "@acme.com")).toBe(false);
  });

  it("stays linear on adversarial input rather than backtracking", () => {
    // The regex this replaced was polynomial on strings like this one.
    const hostile = "a".repeat(40000) + "!";
    const started = process.hrtime.bigint();
    expect(isPlausibleEmail(hostile)).toBe(false);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(50);
  });
});

describe("resolveIndustry", () => {
  it("passes a listed choice straight through", () => {
    expect(resolveIndustry("Manufacturing", "")).toBe("Manufacturing");
  });

  it("returns empty when nothing is selected", () => {
    expect(resolveIndustry("", "")).toBe("");
    expect(resolveIndustry("   ", "anything")).toBe("");
  });

  it("requires a description when Other is chosen", () => {
    // "Other" alone carries no information, so it isn't a complete answer.
    expect(resolveIndustry("Other", "")).toBe("");
    expect(resolveIndustry("Other", "   ")).toBe("");
    expect(resolveIndustry("Other", "Marine salvage")).toBe("Other: Marine salvage");
  });

  it("rejects a category that is not on the list", () => {
    // The picklist's value is comparable data; without this the browser
    // is the only thing enforcing it.
    expect(resolveIndustry("Something Invented", "")).toBe("");
  });

  it("bounds the free-text length", () => {
    const out = resolveIndustry("Other", "x".repeat(500));
    expect(out.length).toBeLessThanOrEqual("Other: ".length + 100);
  });
});

describe("isValidIndustry", () => {
  it("accepts every listed option except the bare Other", () => {
    for (const option of INDUSTRY_OPTIONS) {
      expect(isValidIndustry(option)).toBe(option !== "Other");
    }
  });

  it("accepts a described Other", () => {
    expect(isValidIndustry("Other: Marine salvage")).toBe(true);
  });

  it("rejects empties, invented categories, and an undescribed Other", () => {
    expect(isValidIndustry("")).toBe(false);
    expect(isValidIndustry("   ")).toBe(false);
    expect(isValidIndustry("Other")).toBe(false);
    expect(isValidIndustry("Other: ")).toBe(false);
    expect(isValidIndustry("Invented Category")).toBe(false);
  });

  it("accepts everything resolveIndustry produces", () => {
    for (const option of INDUSTRY_OPTIONS) {
      const resolved = resolveIndustry(option, "Marine salvage");
      if (resolved) expect(isValidIndustry(resolved)).toBe(true);
    }
  });
});
