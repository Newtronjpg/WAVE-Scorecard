import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Header } from "@/components/Header";
import { PrintBrand } from "@/components/PrintBrand";
import { SparkWatermark } from "@/components/SparkWatermark";
import { FIRM_ADDRESS, FIRM_PHONE, FIRM_SITE } from "@/lib/brand";

// The brand guide is a client's, not ours, and these pin the parts of it that
// are easy to break by accident: the palette, the one lockup we are licensed
// to place, and the fact that decoration stays out of the way of both screen
// readers and printers.

afterEach(cleanup);

describe("the header lockup", () => {
  it("names the firm, for anyone who cannot see it", () => {
    render(<Header />);
    expect(screen.getByAltText("Faulk & Winkler")).toBeTruthy();
  });

  it("leads with the firm and follows with the product", () => {
    // Whose assessment this is, then what it is called -- not the reverse.
    const { container } = render(<Header />);
    const text = (container.textContent ?? "").trim();
    expect(text).toBe("WAVE Scorecard");
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(1);
  });

  it("is not a link", () => {
    // A logo that navigates away mid-assessment loses the person who is ten
    // minutes into it. This is branding, not a route back to the marketing
    // site, and the difference matters more here than almost anywhere else.
    render(<Header />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stays off the printed page, which has its own treatment", () => {
    const { container } = render(<Header />);
    expect(container.firstElementChild?.className).toContain("print:hidden");
  });
});

describe("the printed letterhead", () => {
  it("exists only on paper", () => {
    // Screen already has the header above; printing both would stack two
    // lockups on the same page.
    const { container } = render(<PrintBrand />);
    const blocks = container.querySelectorAll("[data-print-brand]");
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.className).toContain("hidden");
      expect(b.className).toContain("print:block");
    }
  });

  it("carries the lockup and how to reach the firm", () => {
    // The point of the whole exercise: a printout handed round a boardroom
    // should say whose it is and how to call them.
    const { container } = render(<PrintBrand />);
    expect(screen.getByAltText("Faulk & Winkler")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain(FIRM_SITE);
    expect(text).toContain(FIRM_PHONE);
    expect(text).toContain(FIRM_ADDRESS);
  });
});

describe("the spark watermark", () => {
  it("is hidden from screen readers", () => {
    // Decoration. Announcing "image" over a results page someone is trying to
    // read is noise, and it carries no information they need.
    const { container } = render(<SparkWatermark />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(within(el as HTMLElement).queryByRole("img")).toBeNull();
  });

  it("never reaches the printer", () => {
    // A full-page pale shape is pure wasted toner.
    const { container } = render(<SparkWatermark />);
    expect(container.firstElementChild?.className).toContain("print:hidden");
  });
});

describe("the palette", () => {
  // Read from the stylesheet rather than asserted against a copy, so this
  // fails when someone tidies a hex rather than when someone edits a fixture.
  const css = readFileSync(
    path.join(import.meta.dirname, "..", "app", "globals.css"),
    "utf8"
  );

  function token(name: string): string | null {
    const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
    return m ? m[1].toUpperCase() : null;
  }

  it("uses the guide's own hex values, not approximations of them", () => {
    expect(token("maroon")).toBe("#6D0104"); // Dark Red
    expect(token("red")).toBe("#AE1B1D"); // Bright Red
    expect(token("paper")).toBe("#F4F3F5"); // Off-White
    expect(token("ink")).toBe("#341515"); // Maroon
    expect(token("ink-muted")).toBe("#5A6779"); // Grey 3
    expect(token("line")).toBe("#C9D3DD"); // Grey 1
  });

  it("keeps body and muted text legible on the new background", () => {
    // The neutrals moved from warm to cool wholesale, and a palette swap is
    // exactly where contrast quietly regresses.
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = c.map((x) =>
        x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
      );
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const paper = token("paper")!;
    expect(ratio(token("ink")!, paper)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token("ink-muted")!, paper)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#FFFFFF", token("red")!)).toBeGreaterThanOrEqual(4.5);
  });
});
