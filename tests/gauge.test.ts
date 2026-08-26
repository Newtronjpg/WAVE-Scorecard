import { describe, it, expect } from "vitest";
import { READINESS_BANDS, bandFor } from "../lib/scoring";
import {
  BAND_COLORS,
  GAUGE_MAX_ANGLE,
  GAUGE_MIN_ANGLE,
  bandColorFor,
  clampScore,
  needleAngleFor,
} from "../lib/gauge";

describe("READINESS_BANDS", () => {
  it("is four evenly spaced bands at 0/25/50/75", () => {
    expect(READINESS_BANDS.map((b) => b.label)).toEqual([
      "Poor",
      "Fair",
      "Good",
      "Great",
    ]);
    expect(READINESS_BANDS.map((b) => b.floor)).toEqual([0, 25, 50, 75]);
  });

  it("has a color for every band and no orphan colors", () => {
    expect(BAND_COLORS).toHaveLength(READINESS_BANDS.length);
  });
});

describe("bandFor boundaries", () => {
  // The boundaries are the whole contract with the emailed spec:
  // Poor 0-24, Fair 25-49, Good 50-74, Great 75-100.
  it.each([
    [0, "Poor"],
    [24, "Poor"],
    [25, "Fair"],
    [49, "Fair"],
    [50, "Good"],
    [74, "Good"],
    [75, "Great"],
    [100, "Great"],
  ])("scores %i as %s", (score, label) => {
    expect(bandFor(score).label).toBe(label);
  });

  it("puts every integer score in exactly one band", () => {
    for (let score = 0; score <= 100; score++) {
      expect(bandFor(score)).toBeDefined();
    }
  });
});

describe("needleAngleFor", () => {
  it("pins the endpoints to the ends of the arc", () => {
    expect(needleAngleFor(0)).toBe(GAUGE_MIN_ANGLE);
    expect(needleAngleFor(100)).toBe(GAUGE_MAX_ANGLE);
    expect(needleAngleFor(50)).toBe(0);
  });

  it("is strictly monotonic across the whole range", () => {
    for (let score = 1; score <= 100; score++) {
      expect(needleAngleFor(score)).toBeGreaterThan(needleAngleFor(score - 1));
    }
  });

  it("separates two scores inside the same band", () => {
    // The reason the gauge exists: 65 and 74 are both Good, and the dial
    // still has to show that 74 is further along.
    expect(bandFor(65).label).toBe(bandFor(74).label);
    expect(needleAngleFor(65)).toBeLessThan(needleAngleFor(74));
  });

  it("never points past the ends of the arc", () => {
    expect(needleAngleFor(-40)).toBe(GAUGE_MIN_ANGLE);
    expect(needleAngleFor(180)).toBe(GAUGE_MAX_ANGLE);
    expect(needleAngleFor(Number.NaN)).toBe(GAUGE_MIN_ANGLE);
  });
});

describe("clampScore", () => {
  it("clamps out of range and non-finite input instead of throwing", () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(101)).toBe(100);
    expect(clampScore(67)).toBe(67);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("bandColorFor", () => {
  it("returns the color matching the band the score lands in", () => {
    expect(bandColorFor(10)).toBe(BAND_COLORS[0]);
    expect(bandColorFor(30)).toBe(BAND_COLORS[1]);
    expect(bandColorFor(67)).toBe(BAND_COLORS[2]);
    expect(bandColorFor(90)).toBe(BAND_COLORS[3]);
  });

  it("resolves a color for every integer score", () => {
    for (let score = 0; score <= 100; score++) {
      expect(BAND_COLORS).toContain(bandColorFor(score));
    }
  });
});
