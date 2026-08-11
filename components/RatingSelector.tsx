"use client";

import { useState } from "react";
import type { Question } from "@/lib/questions";

const TIER_BG: Record<string, string> = {
  Poor: "bg-[var(--color-tier-poor)]",
  Fair: "bg-[var(--color-tier-fair)]",
  Good: "bg-[var(--color-tier-good)]",
  Excellent: "bg-[var(--color-tier-excellent)]",
};

const TIER_TEXT: Record<string, string> = {
  Poor: "text-ink",
  Fair: "text-white",
  Good: "text-white",
  Excellent: "text-white",
};

export function RatingSelector({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  // Tracks whichever number is currently being previewed (tap/hover/focus)
  // so the caption can show a level's meaning before it's committed, not
  // only after. Falls back to the committed value once preview ends.
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const shown = preview ?? value;
  const shownLevel = question.levels.find((l) => l.value === shown);

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="font-display text-lg sm:text-xl leading-snug text-ink mb-4">
        {question.statement}
      </legend>

      <div
        role="radiogroup"
        aria-label={question.statement}
        className="grid grid-cols-5 gap-1.5 sm:gap-2"
      >
        {question.levels.map((level) => {
          const selected = value === level.value;
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${level.value}: ${level.description}`}
              onClick={() => onChange(level.value)}
              onMouseEnter={() => setPreview(level.value)}
              onMouseLeave={() => setPreview(undefined)}
              onFocus={() => setPreview(level.value)}
              onBlur={() => setPreview(undefined)}
              className={[
                "group flex flex-col items-center justify-start gap-1 rounded-lg border-2 px-1 py-2.5 sm:py-3",
                "transition-colors duration-150 cursor-pointer",
                selected
                  ? `${TIER_BG[level.tier]} ${TIER_TEXT[level.tier]} border-transparent`
                  : "bg-paper-raised border-line text-ink hover:border-red",
              ].join(" ")}
            >
              <span className="font-display text-lg sm:text-xl font-medium">
                {level.value}
              </span>
              <span
                className={[
                  "hidden sm:block text-[11px] leading-tight text-center line-clamp-2",
                  selected ? "opacity-90" : "text-ink-muted",
                ].join(" ")}
              >
                {level.label}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className="mt-3 min-h-[3rem] rounded-md border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink-muted"
      >
        {shownLevel ? (
          <span>
            <span className="font-medium text-ink">
              {shownLevel.value} &middot; {shownLevel.tier}.{" "}
            </span>
            {shownLevel.description}
          </span>
        ) : (
          <span className="italic">Tap a number to see what it means for this question.</span>
        )}
      </div>
    </fieldset>
  );
}
