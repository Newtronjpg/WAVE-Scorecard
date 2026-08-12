"use client";

import { useMemo, useState } from "react";
import { GAPS, questionsByGap, QUESTIONS, type Gap } from "@/lib/questions";
import { RatingSelector } from "./RatingSelector";
import { GapScoreBar } from "./GapScoreBar";
import { IntroView } from "./IntroView";

type ScoreResultShape = {
  overallScore: number;
  band: { label: string; description: string };
  gaps: { gap: Gap; name: string; score: number; gapToClose: number }[];
  widestGap: { gap: Gap; name: string; score: number };
  // False when the score was computed but could not be written to the
  // database. Optional so an older cached client bundle still renders.
  saved?: boolean;
};

type View = "intro" | "section" | "submitting" | "results";

const WIDEST_GAP_ADVICE: Record<Gap, string> = {
  wealth:
    "start with a real valuation and a written picture of the number you need to walk away with. Until those two figures are on paper, every other decision here is a guess.",
  accounting:
    "get the monthly close under control and start building toward three years of clean, buyer-ready financials. Little else moves quickly if the numbers underneath it aren't trustworthy.",
  value:
    "reduce how much the business depends on you personally, whether that's customer concentration, your own day-to-day involvement, or knowledge that only exists in your head. That dependency is typically what costs owners the most at the negotiating table.",
  earnings:
    "get a real read on how your margins compare to your industry, and start tracking the handful of numbers that actually explain the gap. It's hard to fix what hasn't been measured.",
};

export function Assessment() {
  const [view, setView] = useState<View>("intro");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [prospectName, setProspectName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [result, setResult] = useState<ScoreResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentGap = GAPS[sectionIndex];
  const currentQuestions = useMemo(
    () => questionsByGap(currentGap.id),
    [currentGap.id]
  );
  const answeredInSection = currentQuestions.filter(
    (q) => answers[q.id] !== undefined
  ).length;
  const allAnsweredInSection = answeredInSection === currentQuestions.length;
  const totalAnswered = QUESTIONS.filter((q) => answers[q.id] !== undefined).length;

  function setAnswer(questionId: string, value: number) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleFinish() {
    setView("submitting");
    setError(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          prospectName: prospectName.trim(),
          companyName: companyName.trim(),
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
      window.scrollTo({ top: 0, behavior: "smooth" });
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleStartOver() {
    setAnswers({});
    setSectionIndex(0);
    setResult(null);
    setError(null);
    setView("intro");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------------- INTRO
  if (view === "intro") {
    return (
      <IntroView
        prospectName={prospectName}
        companyName={companyName}
        onProspectNameChange={setProspectName}
        onCompanyNameChange={setCompanyName}
        onStart={() => setView("section")}
      />
    );
  }

  // -------------------------------------------------------------- RESULTS
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
          // The scores below are real and correct, but this submission was
          // never recorded. Saying so is the whole point: previously this
          // looked identical to a successful save, so neither the prospect
          // nor the firm knew anything had been lost.
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

        <div className="mt-6 flex flex-wrap items-baseline gap-4">
          <span className="font-display text-6xl text-maroon leading-none">
            {result.overallScore}
            <span className="text-2xl text-ink-muted">/100</span>
          </span>
          <span className="inline-block rounded-full bg-[var(--color-tint)] px-3 py-1 text-xs font-medium text-ink">
            {result.band.label}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-muted leading-relaxed max-w-md">
          {result.band.description}
        </p>

        <div className="mt-8 divide-y divide-line">
          {result.gaps.map((g) => (
            <GapScoreBar key={g.gap} name={g.name} score={g.score} />
          ))}
        </div>

        <div className="mt-8 border-l-2 border-maroon pl-4">
          <p className="text-ink leading-relaxed">
            Your overall readiness score is {result.overallScore} out of 100,
            &ldquo;{result.band.label.toLowerCase()}.&rdquo; Your widest gap is your{" "}
            {result.widestGap.name.toLowerCase()} ({result.widestGap.score}/100). If
            you do one thing this year, {WIDEST_GAP_ADVICE[result.widestGap.gap]}
          </p>
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

  // ------------------------------------------------------- SECTION / SUBMIT
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
          style={{ width: `${(totalAnswered / QUESTIONS.length) * 100}%` }}
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
