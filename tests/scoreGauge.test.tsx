import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ScoreGauge } from "@/components/ScoreGauge";
import { BAND_COLORS, needleAngleFor } from "@/lib/gauge";
import { READINESS_BANDS, bandFor } from "@/lib/scoring";

// lib/gauge.ts is unit tested on its own (tests/gauge.test.ts). What is
// untested there is the dial itself, and the dial is now the only place the
// overall reading appears: the numeral is gone and the band pill that used to
// sit below it has been folded into the empty lower half of the arc. If this
// component stops rendering the word, the owner sees a needle and nothing
// else, and no other test would notice.

afterEach(cleanup);

function gauge(score: number) {
  const { container } = render(<ScoreGauge score={score} />);
  return container.querySelector("svg")!;
}

/** The transform is written as `rotate(Ndeg)`; pull N back out of it. */
function needleAngle(svg: SVGElement): number {
  const rotated = [...svg.querySelectorAll("g")].find((g) =>
    g.style.transform?.startsWith("rotate(")
  );
  return Number(/rotate\((-?[\d.]+)deg\)/.exec(rotated!.style.transform)![1]);
}

describe("ScoreGauge", () => {
  it("states the band under the needle, in that band's colour", () => {
    const svg = gauge(62);
    const band = bandFor(62).label;
    // The word appears twice: once as the scale label on the arc, once as the
    // reading. The reading is the one below the pivot -- the arc, and every
    // label on it, sits above CENTER_Y.
    const reading = [...svg.querySelectorAll("text")].find(
      (t) => t.textContent === band && Number(t.getAttribute("y")) > 100
    );
    expect(reading, `no "${band}" reading under the needle`).toBeTruthy();
    expect(reading!.getAttribute("fill")).toBe(
      BAND_COLORS[READINESS_BANDS.indexOf(bandFor(62))]
    );
  });

  it("draws no hub, so the dial is identical on screen, print and PDF", () => {
    // The pivot circle rendered inconsistently across those three. It is not
    // coming back, and this is the assertion that says so -- the needle's own
    // base passes through the pivot and does the job.
    expect(gauge(62).querySelectorAll("circle")).toHaveLength(0);
  });

  it("keeps the number out of the accessible label too", () => {
    // The numeral was removed because "47/100" reads as a grade. Leaving it in
    // aria-label would have restored it for exactly the people who cannot see
    // that it was taken out.
    const label = gauge(47).getAttribute("aria-label")!;
    expect(label).toContain(bandFor(47).label);
    expect(label).not.toMatch(/\d/);
  });

  it("draws the scale identically whatever the score", () => {
    // The arc is a fixed scale, not a readout: same four bands, same weight,
    // same caps, every time. A variant that thinned the track, rounded the
    // caps and faded the three inactive bands was tried and reverted, so this
    // pins the four properties that changed.
    const shape = (score: number) =>
      [...gauge(score).querySelectorAll("path")].map((p) => ({
        stroke: p.getAttribute("stroke"),
        width: p.getAttribute("stroke-width"),
        cap: p.getAttribute("stroke-linecap"),
        opacity: p.getAttribute("opacity"),
      }));

    const low = shape(12);
    cleanup();
    const high = shape(88);
    expect(low).toEqual(high);
    expect(low).toHaveLength(READINESS_BANDS.length);
    for (const seg of low) {
      expect(seg.cap).toBe("butt");
      expect(seg.width).toBe("15");
      // No dimming: absent, not "1" -- nothing should be setting it at all.
      expect(seg.opacity).toBeNull();
    }
  });

  it("moves the needle within a band, not just between them", () => {
    // The reason the dial replaced the numeral rather than the band word
    // replacing both: two scores in the same band still have to read
    // differently.
    expect(bandFor(65).label).toBe(bandFor(74).label);
    expect(needleAngle(gauge(74))).toBeGreaterThan(needleAngle(gauge(65)));
  });

  it("pins the needle to the ends of the arc for out-of-range scores", () => {
    expect(needleAngle(gauge(-20))).toBe(needleAngleFor(0));
    expect(needleAngle(gauge(180))).toBe(needleAngleFor(100));
  });
});
