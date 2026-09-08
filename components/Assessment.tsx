"use client";

import { useEffect, useMemo, useState } from "react";
import { GAPS, type Gap, type Question } from "@/lib/questions";
import { RatingSelector } from "./RatingSelector";
import { ScoreGauge } from "./ScoreGauge";
import { IntroView } from "./IntroView";
import { FollowUpPrompt } from "./FollowUpPrompt";
import { resolveIndustry } from "@/lib/contact";
import { buildGapParagraph, resolvePhrases } from "@/lib/resultsCopy";

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
  // Asked on the last section rather than the results page, so the answer
  // is part of the submission and lands in the one completion email.
  // Null means they never answered, which is not the same as "no".
  const [followUpInterest, setFollowUpInterest] = useState<boolean | null>(null);
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
    return (
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
          Your results
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-ink mt-2">
          Transaction readiness
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
          <ScoreGauge score={result.overallScore} />
          <div className="mt-2 rounded-2xl bg-[var(--color-tint)] px-5 py-2 text-center">
            <span className="block font-display text-2xl text-ink leading-none">
              {result.overallScore}
              <span className="text-sm text-ink-muted">/100</span>
            </span>
            <span className="mt-1 block text-xs font-medium tracking-wide text-ink">
              {result.band.label}
            </span>
          </div>
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
                <span className="text-sm font-medium text-ink whitespace-nowrap">
                  {g.band.label} ({g.score})
                </span>
              </div>
              <p className="mt-2 text-ink leading-relaxed">
                {buildGapParagraph(g.gap, g.band.label, g.lowestQuestionId, g.lowestRating, phrases)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleStartOver}
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper-raised cursor-pointer"
          >
            Start over
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] cursor-pointer"
          >
            Print my results
          </button>
        </div>
      </div>
    );
  }

  // Section / submit
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
        {/* Inside the same divide-y container as the questions, so it
            inherits the rule above it and the identical vertical rhythm
            rather than sitting apart as a tacked-on box. */}
        {sectionIndex === GAPS.length - 1 && (
          <div className="py-8 sm:py-9">
            <FollowUpPrompt
              value={followUpInterest}
              onChange={setFollowUpInterest}
            />
          </div>
        )}
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
          disabled={!allAnsweredInSection || view === "submitting"}
          onClick={handleNext}
          className="rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {view === "submitting"
            ? "Submitting\u2026"
            : sectionIndex === GAPS.length - 1
            ? "See my results"
            : "Next section"}
        </button>
      </div>
    </div>
  );
}
