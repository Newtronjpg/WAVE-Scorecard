import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Assessment } from "@/components/Assessment";
import { withDerivedTiers } from "@/lib/questionSet";
import { GAP_BAND_HELP } from "@/lib/resultsCopy";
import { scoreAssessment } from "@/lib/scoring";
import type { Question } from "@/lib/questions";

// The results view is client-rendered after a submit, so nothing server-side
// proves this copy reaches the page. These render it for real against the live
// question set and read what an owner would actually see.

const V13: Question[] = withDerivedTiers(
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, "fixtures/question-set-v13.json"), "utf8")
  )
);

/** The landing page requires contact details before it will start. */
function fillIntro() {
  fireEvent.change(screen.getByLabelText(/name/i, { selector: "#prospectName" }), {
    target: { value: "Jane Owner" },
  });
  fireEvent.change(screen.getByLabelText(/company/i, { selector: "#companyName" }), {
    target: { value: "Acme Fabrication, Inc." },
  });
  fireEvent.change(screen.getByLabelText(/email/i, { selector: "#email" }), {
    target: { value: "jane@acme.test" },
  });
  const industry = screen.getByLabelText(/industry/i, { selector: "#industry" }) as HTMLSelectElement;
  const option = [...industry.options].find((o) => o.value && o.value !== "Other");
  fireEvent.change(industry, { target: { value: option!.value } });
  fireEvent.click(screen.getByRole("button", { name: /start|begin/i }));
}

/**
 * Answers every question in every section at the given rating and advances.
 * Ratings are role="radio" buttons labelled "<value>: <description>"; the
 * section count comes from the gaps in the question set rather than a literal,
 * so adding a gap does not silently skip one.
 */
function answerSections(rating: number) {
  const sections = new Set(V13.map((q) => q.gap)).size;
  for (let i = 0; i < sections; i++) {
    for (const radio of screen.getAllByRole("radio")) {
      if (radio.getAttribute("aria-label")?.startsWith(`${rating}:`)) {
        fireEvent.click(radio);
      }
    }
    fireEvent.click(
      screen.getByRole("button", { name: /next section|see my results/i })
    );
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Drives the real component through intro, five sections, and submit. */
async function completeAssessment(rating: number) {
  const answers: Record<string, number> = {};
  for (const q of V13) answers[q.id] = rating;
  const score = scoreAssessment(answers, V13);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...score, saved: true }),
    }))
  );

  render(<Assessment questions={V13} version={13} />);
  fillIntro();

  answerSections(rating);

  await waitFor(() => expect(screen.getByText(/Transition readiness/i)).toBeTruthy());
  return score;
}

describe("results view", () => {
  it("shows the band word and never the raw score", async () => {
    const score = await completeAssessment(1);
    expect(screen.getAllByText(score.band.label).length).toBeGreaterThan(0);
    // Ben's note: the number reads as a grade. It must not appear anywhere.
    expect(screen.queryByText("/100")).toBeNull();
    expect(screen.queryByText(String(score.overallScore))).toBeNull();
  });

  it("renders the where-we-can-help copy for every gap at the band scored", async () => {
    const score = await completeAssessment(1);
    for (const gap of score.gaps) {
      const expected = GAP_BAND_HELP[gap.gap][gap.band.label];
      expect(screen.getAllByText(expected).length, `${gap.gap}/${gap.band.label}`)
        .toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Where we can help")).toHaveLength(score.gaps.length);
  });

  it("picks the help copy by band, so a strong business reads differently", async () => {
    const weak = await completeAssessment(1);
    const weakText = GAP_BAND_HELP[weak.gaps[0].gap][weak.gaps[0].band.label];
    cleanup();
    const strong = await completeAssessment(4);
    const strongText = GAP_BAND_HELP[strong.gaps[0].gap][strong.gaps[0].band.label];
    expect(weakText).not.toBe(strongText);
    expect(screen.getAllByText(strongText).length).toBeGreaterThan(0);
    expect(screen.queryByText(weakText)).toBeNull();
  });

  it("puts every question and its chosen answer in the printed appendix", async () => {
    await completeAssessment(2);
    const appendix = screen.getByText("Your answers").closest("section")!;
    for (const q of V13) {
      // Matched on collapsed whitespace: W2's live statement carries a stray
      // double space ("retirement,  and"), which HTML renders as one. The
      // appendix has to contain the question, not a byte-identical string.
      const collapsed = q.statement.replace(/\s+/g, " ").trim();
      expect(
        within(appendix).getAllByText(
          (_, el) => el?.textContent?.replace(/\s+/g, " ").trim() === collapsed
        ).length,
        q.id
      ).toBeGreaterThan(0);
      const chosen = q.levels.find((l) => l.value === 2)!;
      expect(
        within(appendix).getAllByText(new RegExp(chosen.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length,
        q.id
      ).toBeGreaterThan(0);
    }
  });

  it("shows a loading view instead of freezing on the last section", async () => {
    const answers: Record<string, number> = {};
    for (const q of V13) answers[q.id] = 3;
    const score = scoreAssessment(answers, V13);
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((r) => { release = r; }))
    );
    render(<Assessment questions={V13} version={13} />);
    fillIntro();
    answerSections(3);
    await waitFor(() => expect(screen.getByText(/Scoring your assessment/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /see my results/i })).toBeNull();
    release({ ok: true, json: async () => ({ ...score, saved: true }) });
  });
});
