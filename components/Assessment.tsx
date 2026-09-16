"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GAPS, type Gap, type Question } from "@/lib/questions";
import { RatingSelector } from "./RatingSelector";
import { ScoreGauge } from "./ScoreGauge";
import { IntroView } from "./IntroView";
import { FollowUpPrompt } from "./FollowUpPrompt";
import {
  FOLLOW_UP_NOTE_HINT,
  FOLLOW_UP_NOTE_LABEL,
  MAX_FOLLOW_UP_NOTE_LENGTH,
} from "@/lib/followUp";
import { bandColorFor } from "@/lib/gauge";
import { resolveIndustry } from "@/lib/contact";
import {
  GAP_BAND_WORK,
  GAP_ORDER,
  GAP_WORK_HEADING,
  buildGapParagraph,
  resolvePhrases,
} from "@/lib/resultsCopy";

type ScoreResultShape = {
  overallScore: number;
  band: { label: string; description: string };
  // band and lowestQuestionId come straight from scoreAssessment via
  // /api/submit, which spreads the whole result into its JSON response.
  gaps: {
    gap: Gap;
    name: string;
    score: number;
    gapToClose: number;
    band: { label: string };
    lowestQuestionId: string;
    lowestRating: number;
  }[];
  widestGap: { gap: Gap; name: string; score: number };
  // False when the score was computed but could not be written to the
  // database. Optional so an older cached client bundle still renders.
  saved?: boolean;
  // The row's id, for /api/follow-up. Null when the write failed, and absent
  // entirely from /admin/preview -- in both cases there is nothing to attach
  // a follow-up answer to, and the results page must not pretend otherwise.
  submissionId?: string | null;
};

type View = "intro" | "section" | "submitting" | "results";

// Questions arrive as a prop, resolved server-side, so admin edits show up
// without a redeploy. `version` is the published version that produced
// this exact `questions` array, carried through submit untouched so a
// publish landing mid-assessment can't change what gets scored against.
export function Assessment({
  questions,
  version,
  submitPath = "/api/submit",
}: {
  questions: Question[];
  version: number | null;
  // Lets /admin/preview reuse this exact component pointed at
  // /api/admin/preview-score instead of forking it -- a fork would drift
  // from the real assessment and stop being a faithful preview.
  submitPath?: string;
}) {
  const [view, setView] = useState<View>("intro");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  // Optional per-question context, keyed by question id like `answers`.
  // Lives here rather than in RatingSelector so text typed in section 1
  // survives navigating away and back -- the sections are one mounted
  // component, and per-question state would be discarded on every Next.
  const [comments, setComments] = useState<Record<string, string>>({});
  const [prospectName, setProspectName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  // The industry control is two inputs -- a select, plus a free-text box
  // shown only for "Other" -- so both halves are held here and collapsed
  // to one stored string by resolveIndustry at submit time.
  const [industry, setIndustry] = useState("");
  const [industryOther, setIndustryOther] = useState("");
  // Asked on the results page, after the row exists, and sent back on its own
  // via /api/follow-up. Null means they never answered, which is not the same
  // as "no" -- and it is also what keeps "Print my results" locked.
  const [followUpInterest, setFollowUpInterest] = useState<boolean | null>(null);
  // Offered only alongside a yes: what they would like the conversation to
  // cover. Always optional.
  const [followUpNote, setFollowUpNote] = useState("");
  // What the server was last told, so blurring an untouched box, or answering
  // the same way twice, does not spend a write.
  const lastRecorded = useRef<string | null>(null);
  // Whether the note has been explicitly saved, and shown as such. Idle is not
  // "unsaved" -- blur still writes -- it only means nothing has been confirmed
  // on screen yet.
  const [noteStatus, setNoteStatus] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [result, setResult] = useState<ScoreResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Runs in an effect, not the click handler: a handler fires in the same
  // tick as the state update, so the scroll would start against the old
  // section and get cut off when React swaps the content in.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view, sectionIndex]);

  const currentGap = GAPS[sectionIndex];
  const currentQuestions = useMemo(
    () => questions.filter((q) => q.gap === currentGap.id),
    [questions, currentGap.id]
  );
  const answeredInSection = currentQuestions.filter(
    (q) => answers[q.id] !== undefined
  ).length;
  const allAnsweredInSection = answeredInSection === currentQuestions.length;
  const totalAnswered = questions.filter((q) => answers[q.id] !== undefined).length;

  // Resolved from the live questions this run was served, matching on
  // statement text -- the ids in the published set are assigned by
  // /admin/questions and can't be assumed to match the copy table's.
  const phrases = useMemo(() => resolvePhrases(questions), [questions]);

  function setAnswer(questionId: string, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function setComment(questionId: string, value: string) {
    setComments((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleFinish() {
    setView("submitting");
    setError(null);
    try {
      const res = await fetch(submitPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          comments,
          prospectName: prospectName.trim(),
          companyName: companyName.trim(),
          email: email.trim(),
          industry: resolveIndustry(industry, industryOther),
          followUpInterest,
          // The version loaded at the top of this component, not
          // whatever might be published by now.
          questionSetVersion: version,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setView("results");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong submitting the assessment."
      );
      setView("section");
    }
  }

  // The row's id, when there is one. /admin/preview never returns it (nothing
  // was written), and a failed save returns null, so both of those collapse to
  // "there is nothing to record against" -- which is also what unlocks the
  // print button rather than trapping someone behind a question whose answer
  // could not be stored anyway.
  const submissionId = result?.submissionId ?? null;

  /**
   * Sends the answer to /api/follow-up. Deliberately fire-and-forget: their
   * results are already on screen and correct, and a failed write here is not
   * worth an error banner over the top of them. It is skipped entirely when
   * the value has not changed since the last successful send.
   */
  async function recordFollowUp(
    interest: boolean | null,
    note: string
  ): Promise<boolean> {
    if (!submissionId) return false;
    const payload = JSON.stringify({
      submissionId,
      followUpInterest: interest,
      // A note only travels with a yes. Switching to "not at this time" after
      // typing one withdraws it, and the server enforces the same rule.
      //
      // Empty normalises to null here as well as on the server, so that
      // clearing the box and never typing in it produce the identical
      // payload -- otherwise the two are different strings and the
      // "has this actually changed" check below would send a pointless write.
      followUpNote: interest === true && note.trim() ? note.trim() : null,
    });
    // Already stored. Reported as success because it is one -- the value the
    // caller is asking about is on the server.
    if (payload === lastRecorded.current) return true;
    lastRecorded.current = payload;
    try {
      const res = await fetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        // The tab can be closing on the way to the printer; this asks the
        // browser to finish the request anyway.
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      return true;
    } catch {
      // Let the next attempt retry rather than stranding the value.
      lastRecorded.current = null;
      return false;
    }
  }

  function handleFollowUpChange(value: boolean | null) {
    setFollowUpInterest(value);
    if (value !== true) setFollowUpNote("");
    // A stale "Saved" under a box they just re-opened would be a lie.
    setNoteStatus("idle");
    void recordFollowUp(value, value === true ? followUpNote : "");
  }

  // The note saves on blur too, but silently, which is the same as not saving
  // as far as anyone can tell. This is the button that says so out loud.
  async function handleNoteDone() {
    setNoteStatus("saving");
    const ok = await recordFollowUp(followUpInterest, followUpNote);
    setNoteStatus(ok ? "saved" : "failed");
  }

  function handlePrint() {
    // Flushes a note they typed and never blurred -- clicking the button does
    // blur the textarea, but not before this handler runs in every browser.
    void recordFollowUp(followUpInterest, followUpNote);
    window.print();
  }

  function handleNext() {
    if (sectionIndex < GAPS.length - 1) {
      setSectionIndex((i) => i + 1);
    } else {
      handleFinish();
    }
  }

  function handleBack() {
    if (sectionIndex === 0) {
      setView("intro");
    } else {
      setSectionIndex((i) => i - 1);
    }
  }

  function handleStartOver() {
    setAnswers({});
    setComments({});
    setFollowUpInterest(null);
    setFollowUpNote("");
    lastRecorded.current = null;
    setNoteStatus("idle");
    // Name, company, email, and industry deliberately persist: "Start
    // over" retakes the assessment, it does not become a different
    // person, and re-typing all four is pure friction.
    setSectionIndex(0);
    setResult(null);
    setError(null);
    setView("intro");
  }

  // Intro
  if (view === "intro") {
    return (
      <IntroView
        prospectName={prospectName}
        companyName={companyName}
        email={email}
        industry={industry}
        industryOther={industryOther}
        onProspectNameChange={setProspectName}
        onCompanyNameChange={setCompanyName}
        onEmailChange={setEmail}
        onIndustryChange={setIndustry}
        onIndustryOtherChange={setIndustryOther}
        onStart={() => setView("section")}
      />
    );
  }

  // Results
  if (view === "results" && result) {
    // Unlocked by an answer -- either answer -- or by there being nothing to
    // record against in the first place.
    const canPrint = followUpInterest !== null || !submissionId;

    return (
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
          Your results
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-ink mt-2">
          Transition readiness
        </h1>

        {result.saved === false && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-maroon bg-[var(--color-tint)] px-4 py-3"
          >
            <p className="text-sm font-medium text-ink">
              Your results weren&rsquo;t saved.
            </p>
            <p className="mt-1 text-sm text-ink-muted leading-relaxed">
              Your scores below are correct, but we couldn&rsquo;t record them.
              Please print or screenshot this page and send it to us so nothing
              is lost. We&rsquo;ve been notified.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-col items-center">
          {/* The number is deliberately absent: Ben's call is that "47/100"
              reads as a grade and puts owners on the defensive, while the
              needle plus the word carries the same information without the
              scolding. The score still drives the needle and still travels to
              the admin export -- it is only hidden from the owner.
              The band word lives inside the dial now, in the empty half a
              180-degree gauge leaves under its hub, rather than in a pill
              below it that repeated the word an inch away. */}
          <ScoreGauge score={result.overallScore} />
        </div>
        <p className="mt-3 mx-auto max-w-md text-center text-sm text-ink-muted leading-relaxed">
          {result.band.description}
        </p>

        {/* Same divide-y rhythm the question sections use, so the four gap
            readouts read as one list rather than four stacked cards. */}
        <div className="mt-8 divide-y divide-line">
          {result.gaps.map((g) => (
            <div key={g.gap} className="py-6 sm:py-7 first:pt-0">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-display text-xl text-ink">{g.name}</h3>
                {/* Same red-to-green ramp as the gauge arc, so a gap reading
                    "Fair" is the same orange the needle would sit in. Colour is
                    not the only carrier -- the word is always present -- so this
                    still reads for anyone who cannot distinguish them. */}
                <span
                  className="text-sm font-semibold whitespace-nowrap"
                  style={{ color: bandColorFor(g.score) }}
                >
                  {g.band.label}
                </span>
              </div>
              <p className="mt-2 text-ink leading-relaxed">
                {buildGapParagraph(g.gap, g.band.label, g.lowestQuestionId, g.lowestRating, phrases)}
              </p>
              {/* Work F&W has already done for a business in this position.
                  A tinted block rather than another paragraph, so the shift
                  from "here is where you stand" to "here is what that has
                  looked like" is visible without a heading shouting it.
                  Rendered only when there is copy: the block is awaiting
                  Brandon's language, and an empty tinted box on a live results
                  page reads as a bug. */}
              {GAP_BAND_WORK[g.gap][g.band.label] && (
                <div className="mt-4 rounded-md bg-[var(--color-tint)] px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {GAP_WORK_HEADING}
                  </p>
                  <p className="mt-1.5 text-sm text-ink leading-relaxed">
                    {GAP_BAND_WORK[g.gap][g.band.label]}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Second page of the printout: every question, the answer they chose,
            and anything they typed. Hidden on screen -- the results page is a
            summary and stays one. Ben asked for it so the printed copy is a
            complete record of what the owner actually said, which is what a
            conversation two weeks later needs. */}
        <section
          className="hidden print:block"
          style={{ breakBefore: "page" }}
          aria-hidden="true"
        >
          <h2 className="font-display text-2xl text-ink">Your answers</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Every question, as you answered it.
          </p>
          <div className="mt-6 divide-y divide-line">
            {GAP_ORDER.map((gapId) => {
              const gapQuestions = questions.filter((q) => q.gap === gapId);
              if (gapQuestions.length === 0) return null;
              const meta = GAPS.find((g) => g.id === gapId);
              return (
                <div key={gapId} className="py-4 first:pt-0">
                  <h3 className="font-display text-lg text-ink">{meta?.name ?? gapId}</h3>
                  <dl className="mt-2 space-y-3">
                    {gapQuestions.map((q) => {
                      const chosen = q.levels.find((l) => l.value === answers[q.id]);
                      const note = comments[q.id]?.trim();
                      return (
                        <div key={q.id} style={{ breakInside: "avoid" }}>
                          <dt className="text-sm text-ink">{q.statement}</dt>
                          <dd className="mt-0.5 text-sm text-ink-muted">
                            {chosen
                              ? `${chosen.value}. ${chosen.label} — ${chosen.description}`
                              : "Not answered"}
                          </dd>
                          {note && (
                            <dd className="mt-0.5 text-sm text-ink italic">
                              Their note: {note}
                            </dd>
                          )}
                        </div>
                      );
                    })}
                  </dl>
                </div>
              );
            })}
          </div>
        </section>

        {/* Brandon's placement: the question sits with the two things someone
            does at the end, not on a screen of its own before the results.
            Print stays locked until it is answered -- the one moment we have
            their attention is the moment they want the printout, so that is
            where the ask goes. Interactive, so it never reaches the printout
            itself. */}
        <div className="mt-10 border-t border-line pt-8 print:hidden">
          <FollowUpPrompt
            value={followUpInterest}
            onChange={handleFollowUpChange}
          />

          {/* Only alongside a yes. Asking someone who just declined what they
              would like to discuss reads as not having listened. */}
          {followUpInterest === true && (
            <div className="mt-6">
              <label
                htmlFor="followUpNote"
                className="block font-display text-lg text-ink"
              >
                {FOLLOW_UP_NOTE_LABEL}
              </label>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">
                {FOLLOW_UP_NOTE_HINT}
              </p>
              <textarea
                id="followUpNote"
                rows={4}
                maxLength={MAX_FOLLOW_UP_NOTE_LENGTH}
                value={followUpNote}
                onChange={(e) => {
                  setFollowUpNote(e.target.value);
                  // The confirmation belongs to the text that earned it.
                  setNoteStatus("idle");
                }}
                // Written on blur as well as by the button: blur is the safety
                // net for someone who types and then clicks straight to print,
                // and it is per-blur rather than per-keystroke so one sentence
                // cannot burn the endpoint's throttle.
                onBlur={() => void recordFollowUp(followUpInterest, followUpNote)}
                className="mt-3 block w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink leading-relaxed focus:border-maroon focus:outline-none"
              />

              {/* Saving on blur alone left nothing on screen to say it had
                  happened, which reads exactly like not saving at all. The
                  button does not gate anything -- the note is still optional
                  and print is already unlocked by the answer above -- it
                  exists so there is somewhere to put "Saved". */}
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleNoteDone}
                  disabled={noteStatus === "saving"}
                  className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper-raised disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {noteStatus === "saving" ? "Saving..." : "Done"}
                </button>
                <span
                  aria-live="polite"
                  className={[
                    "text-sm",
                    noteStatus === "failed" ? "text-maroon" : "text-ink-muted",
                  ].join(" ")}
                >
                  {noteStatus === "saved" && "Saved \u2014 thank you."}
                  {noteStatus === "failed" &&
                    "That didn't send. Please try again."}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 print:hidden">
          <button
            type="button"
            onClick={handleStartOver}
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper-raised cursor-pointer"
          >
            Start over
          </button>
          <button
            type="button"
            onClick={handlePrint}
            // Locked until they answer -- but never when there is nothing to
            // record against, because then the question is unanswerable in
            // any useful sense and locking it would just strand them with a
            // printout they cannot take.
            disabled={!canPrint}
            aria-describedby={canPrint ? undefined : "printLockReason"}
            className="rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Print my results
          </button>
        </div>
        {!canPrint && (
          // Said plainly rather than left to a greyed-out button. A disabled
          // control with no stated reason reads as a broken page.
          <p
            id="printLockReason"
            className="mt-3 text-sm text-ink-muted print:hidden"
          >
            Answer the question above to print your results.
          </p>
        )}
      </div>
    );
  }

  // Submitting
  //
  // Previously this fell through to the section render with only the button
  // label changed, so the whole page sat still while the request was in
  // flight -- Ben's note was that it "appears to freeze before jumping to the
  // results". Scoring is fast, but a cold serverless function plus a database
  // write is long enough for an owner to think the button did nothing and
  // click it again. A dedicated view makes the wait legible.
  if (view === "submitting") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:py-32">
        <div
          className="flex flex-col items-center text-center"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className="h-9 w-9 rounded-full border-2 border-line border-t-maroon motion-safe:animate-spin"
          />
          <p className="mt-6 font-display text-2xl text-ink">
            Scoring your assessment
          </p>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            This takes a few seconds. Please don&rsquo;t close this page.
          </p>
        </div>
      </div>
    );
  }

  // Section
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
      <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
        Section {sectionIndex + 1} of {GAPS.length}
      </p>
      <h2 className="font-display text-3xl text-ink mt-2">{currentGap.name}</h2>
      <p className="text-ink-muted italic mt-1">{currentGap.tagline}</p>

      <div className="mt-4 h-1 w-full rounded-full bg-[var(--color-tint)] overflow-hidden">
        <div
          className="h-full bg-maroon transition-[width] duration-300"
          style={{ width: `${(totalAnswered / questions.length) * 100}%` }}
        />
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-red bg-[var(--color-tint)] px-4 py-3 text-sm text-ink">
          {error}
        </div>
      )}

      <div className="mt-8 divide-y divide-line">
        {currentQuestions.map((q) => (
          <div key={q.id} className="py-8 sm:py-9 first:pt-0">
            <RatingSelector
              question={q}
              value={answers[q.id]}
              onChange={(value) => setAnswer(q.id, value)}
              comment={comments[q.id]}
              onCommentChange={(value) => setComment(q.id, value)}
            />
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper-raised cursor-pointer"
        >
          Back
        </button>
        <p className="text-sm text-ink-muted">{answeredInSection} of {currentQuestions.length} answered</p>
        <button
          type="button"
          // The submitting view has already taken over by the time a second
          // click could land, so the guard here is only about completeness.
          disabled={!allAnsweredInSection}
          onClick={handleNext}
          className="rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {sectionIndex === GAPS.length - 1 ? "See my results" : "Next section"}
        </button>
      </div>
    </div>
  );
}
