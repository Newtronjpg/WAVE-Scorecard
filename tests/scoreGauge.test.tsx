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
  it("states the band in the dial, once", () => {
    const svg = gauge(62);
    const band = bandFor(62).label;
    // The scale labels around the arc are upper-cased, so an exact match on
    // the band's own casing finds the reading under the hub and nothing else.
    const reading = [...svg.querySelectorAll("text")].find(
      (t) => t.textContent === band
    );
    expect(reading, `no "${band}" reading in the dial`).toBeTruthy();
    expect(reading!.getAttribute("fill")).toBe(BAND_COLORS[READINESS_BANDS.indexOf(bandFor(62))]);
  });

  it("keeps the number out of the accessible label too", () => {
    // The numeral was removed because "47/100" reads as a grade. Leaving it in
    // aria-label would have restored it for exactly the people who cannot see
    // that it was taken out.
    const label = gauge(47).getAttribute("aria-label")!;
    expect(label).toContain(bandFor(47).label);
    expect(label).not.toMatch(/\d/);
  });

  it("dims every band except the one scored", () => {
    const paths = [...gauge(88).querySelectorAll("path")];
    const opacities = paths.map((p) => Number(p.getAttribute("opacity")));
    expect(opacities.filter((o) => o === 1)).toHaveLength(1);
    expect(opacities.filter((o) => o < 1)).toHaveLength(READINESS_BANDS.length - 1);
    // The full-strength arc is the band the score landed in -- fourth of four
    // at 88, so last in document order.
    expect(paths[READINESS_BANDS.indexOf(bandFor(88))].getAttribute("opacity")).toBe("1");
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
