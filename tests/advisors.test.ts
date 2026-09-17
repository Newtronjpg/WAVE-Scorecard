import { describe, it, expect } from "vitest";
import {
  ADVISOR_AREA_IDS,
  ADVISOR_AREAS,
  ADVISOR_RATINGS,
  MAX_ADVISOR_NAME_LENGTH,
  advisorCount,
  formatAdvisorEntry,
  normalizeAdvisorRatings,
} from "@/lib/advisors";

// This section is OPTIONAL, which is the property most of these protect: the
// most important thing it can do is never cost someone the assessment they
// just spent ten minutes on.

describe("the advisor areas", () => {
  it("is exactly the six Brandon listed, in his order", () => {
    expect(ADVISOR_AREAS.map((a) => a.label)).toEqual([
      "Accounting",
      "Legal",
      "Banking",
      "Insurance",
      "Wealth Management",
      "HR",
    ]);
  });

  it("uses the same four words as the rest of the results", () => {
    // Someone has just read Poor/Fair/Good/Great as a scale for ten minutes.
    // A second vocabulary here would make them learn one scale twice.
    expect(ADVISOR_RATINGS.map((r) => r.label)).toEqual([
      "Poor",
      "Fair",
      "Good",
      "Great",
    ]);
  });
});

describe("normalizeAdvisorRatings", () => {
  it("keeps a rating and a name together", () => {
    expect(
      normalizeAdvisorRatings({ legal: { rating: 3, name: "Smith LLP" } })
    ).toEqual({ legal: { rating: 3, name: "Smith LLP" } });
  });

  it("keeps either one alone", () => {
    expect(normalizeAdvisorRatings({ hr: { rating: 2 } })).toEqual({
      hr: { rating: 2 },
    });
    expect(normalizeAdvisorRatings({ hr: { name: "In-house" } })).toEqual({
      hr: { name: "In-house" },
    });
  });

  it("returns null for a skipped section rather than an empty object", () => {
    // Same rule as `comments`: "said nothing" gets one representation.
    for (const skipped of [null, undefined, {}, "", 0, [], { legal: {} }]) {
      expect(normalizeAdvisorRatings(skipped), JSON.stringify(skipped)).toBeNull();
    }
  });

  it("drops an area with neither a rating nor a name", () => {
    expect(
      normalizeAdvisorRatings({ legal: { rating: 3 }, hr: { name: "   " } })
    ).toEqual({ legal: { rating: 3 } });
  });

  it("refuses ratings outside the scale instead of storing them", () => {
    for (const rating of [0, 5, -1, 2.5, "3", null, NaN, Infinity]) {
      const out = normalizeAdvisorRatings({ legal: { rating, name: "Kept" } });
      expect(out?.legal?.rating, String(rating)).toBeUndefined();
      // The name still survives; one bad field must not discard the other.
      expect(out?.legal?.name).toBe("Kept");
    }
  });

  it("ignores areas that are not ours", () => {
    // A hand-crafted request must not be able to put arbitrary keys in the
    // column and out through the export.
    expect(
      normalizeAdvisorRatings({
        legal: { rating: 1 },
        astrology: { rating: 4, name: "Mystic Meg" },
        __proto__: { rating: 4 },
      })
    ).toEqual({ legal: { rating: 1 } });
  });

  it("trims and truncates a name rather than rejecting it", () => {
    expect(
      normalizeAdvisorRatings({ banking: { name: "  Big Bank  " } })
    ).toEqual({ banking: { name: "Big Bank" } });

    const long = normalizeAdvisorRatings({ banking: { name: "x".repeat(500) } });
    expect(long?.banking?.name).toHaveLength(MAX_ADVISOR_NAME_LENGTH);
  });

  it("survives shapes a browser would never send", () => {
    for (const hostile of [
      { legal: "not-an-object" },
      { legal: [1, 2, 3] },
      { legal: null },
      [{ legal: { rating: 1 } }],
    ]) {
      expect(() => normalizeAdvisorRatings(hostile)).not.toThrow();
    }
  });
});

describe("reading it back", () => {
  it("counts only the areas actually answered", () => {
    expect(advisorCount(null)).toBe(0);
    expect(advisorCount({})).toBe(0);
    expect(
      advisorCount({ legal: { rating: 1 }, hr: { name: "A" }, banking: {} })
    ).toBe(2);
  });

  it("formats an entry for the export", () => {
    expect(formatAdvisorEntry("legal", { rating: 3, name: "Smith LLP" })).toBe(
      "Legal: Good (Smith LLP)"
    );
    expect(formatAdvisorEntry("hr", { rating: 4 })).toBe("HR: Great");
    expect(formatAdvisorEntry("banking", { name: "Big Bank" })).toBe(
      "Banking: (Big Bank)"
    );
  });

  it("names every area it can be given", () => {
    for (const id of ADVISOR_AREA_IDS) {
      expect(formatAdvisorEntry(id, { rating: 1 })).not.toContain(id);
    }
  });
});
