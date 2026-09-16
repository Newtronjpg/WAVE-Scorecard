import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Assessment } from "@/components/Assessment";
import { withDerivedTiers } from "@/lib/questionSet";
import { GAP_BAND_WORK, GAP_WORK_HEADING } from "@/lib/resultsCopy";
import {
  FOLLOW_UP_NO,
  FOLLOW_UP_NOTE_LABEL,
  FOLLOW_UP_QUESTION,
  FOLLOW_UP_YES,
} from "@/lib/followUp";
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
      json: async () => ({ ...score, saved: true, submissionId: "sub_test_1" }),
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

  it("shows no work block at all while Brandon's copy is pending", async () => {
    // The slots exist but are empty, and an empty tinted box on a live results
    // page reads as a bug. Written so that when the copy lands this asserts the
    // opposite branch instead of needing an edit.
    //
    // (The old pair of tests here checked the retired "where we can help"
    // copy. Its per-band wording is still covered directly in
    // tests/resultsCopy.test.ts, so nothing is lost by them going.)
    const score = await completeAssessment(1);
    const written = score.gaps.filter(
      (g) => GAP_BAND_WORK[g.gap][g.band.label].length > 0
    );
    if (written.length > 0) {
      for (const gap of written) {
        const expected = GAP_BAND_WORK[gap.gap][gap.band.label];
        expect(screen.getAllByText(expected).length, gap.gap).toBeGreaterThan(0);
      }
      expect(screen.getAllByText(GAP_WORK_HEADING)).toHaveLength(written.length);
    } else {
      expect(screen.queryByText(GAP_WORK_HEADING)).toBeNull();
    }
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


// Brandon moved the question onto the results page, beside the two things
// someone does at the end, and locked "Print my results" behind it. That means
// the answer now arrives AFTER the row is written and after the completion
// email has gone, so it travels on its own to /api/follow-up. These assert the
// lock, the note box, and the request -- the request most of all, because it is
// the only way the answer reaches anybody.
describe("the follow-up question on the results page", () => {
  /** Completes an assessment and hands back the fetch mock, submit included. */
  async function atResults(
    opts: { submissionId?: string | null; followUpOk?: boolean } = {}
  ) {
    const answers: Record<string, number> = {};
    for (const q of V13) answers[q.id] = 3;
    const score = scoreAssessment(answers, V13);
    // Routed, so a failing /api/follow-up can be tested without also breaking
    // the submit that has to succeed first.
    const fetchMock = vi.fn(async (url: string) => ({
      ok: url === "/api/follow-up" ? opts.followUpOk !== false : true,
      status: url === "/api/follow-up" && opts.followUpOk === false ? 500 : 200,
      json: async () => ({
        ...score,
        saved: true,
        submissionId: "submissionId" in opts ? opts.submissionId : "sub_test_1",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Assessment questions={V13} version={13} />);
    fillIntro();
    answerSections(3);
    await waitFor(() => expect(screen.getByText(/Transition readiness/i)).toBeTruthy());
    return fetchMock;
  }

  const printButton = () =>
    screen.getByRole("button", { name: /print my results/i }) as HTMLButtonElement;

  /** The bodies of every POST to /api/follow-up, in order. */
  function followUpCalls(fetchMock: { mock: { calls: unknown[][] } }) {
    return fetchMock.mock.calls
      .filter((c) => c[0] === "/api/follow-up")
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
  }

  it("locks printing until the question is answered", async () => {
    await atResults();
    expect(printButton().disabled).toBe(true);
    // And says why, rather than leaving a dead grey button.
    expect(screen.getByText(/answer the question above to print/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_NO }));
    expect(printButton().disabled).toBe(false);
    expect(screen.queryByText(/answer the question above to print/i)).toBeNull();
  });

  it("unlocks on a yes as readily as on a no", async () => {
    await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    expect(printButton().disabled).toBe(false);
  });

  it("records the answer against the row the submit created", async () => {
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    await waitFor(() => expect(followUpCalls(fetchMock)).toHaveLength(1));
    expect(followUpCalls(fetchMock)[0]).toEqual({
      submissionId: "sub_test_1",
      followUpInterest: true,
      followUpNote: null,
    });
  });

  it("offers the note box only to someone who said yes", async () => {
    await atResults();
    expect(screen.queryByLabelText(FOLLOW_UP_NOTE_LABEL)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    expect(screen.getByLabelText(FOLLOW_UP_NOTE_LABEL)).toBeTruthy();

    // Asking someone who just declined what they would like to discuss reads
    // as not having listened.
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_NO }));
    expect(screen.queryByLabelText(FOLLOW_UP_NOTE_LABEL)).toBeNull();
  });

  it("sends the note when they leave the box", async () => {
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.change(box, { target: { value: "  Succession timing, mainly.  " } });
    fireEvent.blur(box);

    await waitFor(() => expect(followUpCalls(fetchMock).length).toBeGreaterThan(1));
    const last = followUpCalls(fetchMock).at(-1);
    expect(last.followUpNote).toBe("Succession timing, mainly.");
    expect(last.followUpInterest).toBe(true);
  });

  it("withdraws a note when they change their mind to no", async () => {
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.change(box, { target: { value: "Call me about the building." } });
    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_NO }));

    await waitFor(() => {
      const last = followUpCalls(fetchMock).at(-1);
      expect(last.followUpInterest).toBe(false);
      // Keeping it would put words in the mouth of someone who just declined.
      expect(last.followUpNote).toBeNull();
    });
  });

  it("spends no write when the answer has not actually changed", async () => {
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    await waitFor(() => expect(followUpCalls(fetchMock)).toHaveLength(1));
    // Blurring an untouched box, with the same answer already sent.
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.blur(box);
    fireEvent.blur(box);
    expect(followUpCalls(fetchMock)).toHaveLength(1);
  });

  it("never traps someone whose submission was not saved", async () => {
    // No id means there is nothing to record against, so the question cannot
    // be answered in any useful sense -- locking the printout behind it would
    // strand them with results they cannot take away.
    await atResults({ submissionId: null });
    expect(printButton().disabled).toBe(false);
    expect(screen.queryByText(/answer the question above to print/i)).toBeNull();
  });

  it("asks nobody twice -- the question is gone from the last section", () => {
    render(<Assessment questions={V13} version={13} />);
    fillIntro();
    for (let i = 0; i < new Set(V13.map((q) => q.gap)).size - 1; i++) {
      for (const radio of screen.getAllByRole("radio")) {
        if (radio.getAttribute("aria-label")?.startsWith("3:")) fireEvent.click(radio);
      }
      fireEvent.click(screen.getByRole("button", { name: /next section/i }));
    }
    expect(screen.queryByText(FOLLOW_UP_QUESTION)).toBeNull();
    expect(screen.getByRole("button", { name: /see my results/i })).toBeTruthy();
  });
  it("gives the note a Done button, and says so when it lands", async () => {
    // Blur alone saved it, but silently, and a save nobody can see is the same
    // as no save. Noah's note: there has to be something to press.
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    fireEvent.change(screen.getByLabelText(FOLLOW_UP_NOTE_LABEL), {
      target: { value: "We are three years out from selling." },
    });

    expect(screen.queryByText(/saved/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeTruthy());
    expect(followUpCalls(fetchMock).at(-1).followUpNote).toBe(
      "We are three years out from selling."
    );
  });

  it("drops the confirmation as soon as the text changes again", async () => {
    // "Saved" has to belong to the words on screen, not to whatever was there
    // a moment ago.
    await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.change(box, { target: { value: "First thought." } });
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(screen.getByText(/saved/i)).toBeTruthy());

    fireEvent.change(box, { target: { value: "First thought, expanded." } });
    expect(screen.queryByText(/saved/i)).toBeNull();
  });

  it("admits it when the note does not send", async () => {
    // Showing "Saved" over a failed write would be the worst outcome here:
    // they would leave believing F&W had context that nobody has.
    await atResults({ followUpOk: false });
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    fireEvent.change(screen.getByLabelText(FOLLOW_UP_NOTE_LABEL), {
      target: { value: "Something worth knowing." },
    });
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() =>
      expect(screen.getByText(/didn't send. please try again/i)).toBeTruthy()
    );
    expect(screen.queryByText(/saved/i)).toBeNull();
  });

  it("lets a failed note be retried rather than stranding it", async () => {
    const fetchMock = await atResults({ followUpOk: false });
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    fireEvent.change(screen.getByLabelText(FOLLOW_UP_NOTE_LABEL), {
      target: { value: "Retry me." },
    });
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    // Matched on the note's own message: the answer-level failure alert also
    // offers a "Try again", so a bare /try again/ now finds two things.
    await waitFor(() => expect(screen.getByText(/didn't send/i)).toBeTruthy());

    const before = followUpCalls(fetchMock).length;
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    // The identical payload must go again, not be skipped as "unchanged".
    await waitFor(() =>
      expect(followUpCalls(fetchMock).length).toBeGreaterThan(before)
    );
  });

  it("never gates the printout behind the note", async () => {
    // The lock belongs to the question, which is answered. The note is
    // optional and must stay that way.
    await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    expect(printButton().disabled).toBe(false);
    expect(screen.getByRole("button", { name: /done/i })).toBeTruthy();
  });
  it("does not claim Saved when blur and Done race, and the write failed", async () => {
    // REGRESSION. Clicking Done blurs the textarea first in every real
    // browser, so blur and click fire with identical payloads microseconds
    // apart -- the normal path, not an edge case. The optimistic cache used
    // to make the click resolve true off the blur's still-in-flight request,
    // so a failed write displayed "Saved": the exact lie this button exists
    // to prevent. Reproduced before the fix; it showed "Saved".
    await atResults({ followUpOk: false });
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.change(box, { target: { value: "Important context." } });

    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => expect(screen.getByText(/didn't send/i)).toBeTruthy());
    expect(screen.queryByText(/^Saved/i)).toBeNull();
  });

  it("shares one request when blur and Done race and it succeeds", async () => {
    // The other half: deduplicated, not merely correct. Two identical writes
    // for one click would be waste, and would spend the endpoint's throttle.
    const fetchMock = await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    const box = screen.getByLabelText(FOLLOW_UP_NOTE_LABEL);
    fireEvent.change(box, { target: { value: "One write only." } });

    fireEvent.blur(box);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => expect(screen.getByText(/saved/i)).toBeTruthy());
    const withNote = followUpCalls(fetchMock).filter(
      (c) => c.followUpNote === "One write only."
    );
    expect(withNote).toHaveLength(1);
  });

  it("tells them when the answer itself could not be recorded", async () => {
    // This used to be entirely silent: print unlocks on local state, so
    // someone could answer yes, have the write fail, print, and leave with
    // nobody knowing the lead was lost.
    await atResults({ followUpOk: false });
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /couldn.t record that answer/i
      )
    );
    // Still not a blocker -- their results are correct and printable.
    expect(printButton().disabled).toBe(false);
  });

  it("stays quiet when the answer lands", async () => {
    await atResults();
    fireEvent.click(screen.getByRole("radio", { name: FOLLOW_UP_YES }));
    await waitFor(() => expect(printButton().disabled).toBe(false));
    expect(screen.queryByText(/couldn.t record that answer/i)).toBeNull();
  });
});
