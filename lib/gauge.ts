// View math and palette for the results-page speedometer.
//
// Split out from lib/scoring.ts so that file stays purely arithmetic: the
// bands themselves are a scoring concern, but what color they're painted
// and where the needle sits are not.
//
// Zero dependencies on React or the DOM, so this is unit tested directly
// (tests/gauge.test.ts).

import { READINESS_BANDS, bandFor } from "./scoring";

// Parallel BY INDEX to READINESS_BANDS -- a red-to-green ramp running left
// to right across the arc. Desaturated on purpose: these sit next to the
// brand maroon on warm paper, and full-strength web red/green fights it.
export const BAND_COLORS: string[] = [
  "#b3261e", // Poor
  "#d98324", // Fair
  "#7d9a3e", // Good
  "#3f7d3f", // Great
];

export const GAUGE_MIN_ANGLE = -90;
export const GAUGE_MAX_ANGLE = 90;

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

// Linear across the full 0-100 range rather than snapped to band centers.
// That's the whole point of the gauge: 74 and 65 are both "Good", but 74
// has to visibly sit farther right, or the picture is lying about the
// difference between them.
export function needleAngleFor(score: number): number {
  const pct = clampScore(score) / 100;
  return GAUGE_MIN_ANGLE + pct * (GAUGE_MAX_ANGLE - GAUGE_MIN_ANGLE);
}

export function bandColorFor(score: number): string {
  const band = bandFor(clampScore(score));
  const index = READINESS_BANDS.indexOf(band);
  return BAND_COLORS[index];
}
