"use client";

import { useState } from "react";
import type { Question } from "@/lib/questions";

export function RatingSelector({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  // Previews a level's meaning on hover/focus before anything is picked.
  // Once a value is committed, `shown` locks to it and ignores further
  // hover/focus, so the caption stops moving after an answer is chosen.
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const shown = value ?? preview;
  const shownLevel = question.levels.find((l) => l.value === shown);
  const answered = value !== undefined;

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="font-display text-lg sm:text-xl leading-snug text-ink mb-4">
        {question.statement}
      </legend>

      <div
        role="radiogroup"
        aria-label={question.statement}
        className="grid gap-2"
        style={{
          // An interpolated Tailwind class (grid-cols-${n}) would be
          // purged at build time, so this has to be inline.
          gridTemplateColumns: `repeat(${question.levels.length}, minmax(0, 1fr))`,
        }}
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
                "flex items-center justify-center rounded-lg border-2 py-3",
                "transition-colors duration-150 cursor-pointer",
                // One color for "selected," always, regardless of which
                // number it is. No per-tier color ramp.
                selected
                  ? "bg-maroon text-white border-transparent"
                  : "bg-paper-raised border-line text-ink hover:border-red",
              ].join(" ")}
            >
              <span className="font-display text-xl sm:text-2xl font-medium">
                {level.value}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className={[
          "mt-3 min-h-[2.75rem] border-l-2 pl-3 py-1 text-sm text-ink-muted",
          answered ? "border-maroon" : "border-line",
        ].join(" ")}
      >
        {shownLevel ? (
          <span>
            <span className="font-medium text-ink">{shownLevel.value}. </span>
            {shownLevel.description}
          </span>
        ) : (
          <span className="italic">Tap a number to see what it means for this question.</span>
        )}
      </div>
    </fieldset>
  );
}
