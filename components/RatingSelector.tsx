"use client";

import { useId, useState } from "react";
import type { Question } from "@/lib/questions";
import { MAX_COMMENT_LENGTH } from "@/lib/comments";

// Show the counter only once it's nearly relevant. A counter sitting under
// an empty box reads as a word limit to hit rather than a ceiling.
const COUNTER_VISIBLE_WITHIN = 100;

export function RatingSelector({
  question,
  value,
  onChange,
  comment,
  onCommentChange,
}: {
  question: Question;
  value: number | undefined;
  onChange: (value: number) => void;
  // Optional so the context UI is opt-in per call site rather than
  // unconditional. Every current caller (components/Assessment.tsx, which
  // /admin/preview also renders) passes both, so today the omitted case is
  // a capability this component keeps, not a path anything exercises.
  comment?: string;
  onCommentChange?: (value: string) => void;
}) {
  // Previews a level's meaning on hover/focus before anything is picked.
  // Once a value is committed, `shown` locks to it and ignores further
  // hover/focus, so the caption stops moving after an answer is chosen.
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const shown = value ?? preview;
  const shownLevel = question.levels.find((l) => l.value === shown);
  const answered = value !== undefined;

  const [contextOpen, setContextOpen] = useState(false);
  const textareaId = useId();
  const trimmedComment = (comment ?? "").trim();
  const hasComment = trimmedComment.length > 0;
  const remaining = MAX_COMMENT_LENGTH - (comment ?? "").length;

  return (
    // min-w-0: browsers give fieldset a default min-inline-size of
    // min-content, so unlike a div it refuses to shrink below its widest
    // child. Without this a long context preview widens the whole question
    // and pushes the rating buttons off a narrow screen.
    <fieldset className="border-0 p-0 m-0 min-w-0">
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

      {onCommentChange && (
        <div className="mt-2">
          {!contextOpen && (
            // min-h keeps the collapsed row the same height whether or not a
            // preview line is showing, so opening and closing boxes down the
            // page doesn't shuffle the questions under them.
            <div className="flex min-h-[1.5rem] items-baseline gap-2">
              <button
                type="button"
                onClick={() => setContextOpen(true)}
                // aria-expanded without aria-controls: the textarea does not
                // exist while collapsed, so naming it here would point
                // assistive tech at an id that resolves to nothing.
                aria-expanded={false}
                className="shrink-0 text-xs text-ink-muted hover:text-maroon cursor-pointer"
              >
                {hasComment ? "Context added" : "+ Add context"}
              </button>
              {hasComment && (
                // min-w-0 is load-bearing: a truncating flex child keeps its
                // full intrinsic width without it, and a long note pushes the
                // whole question row wider than the viewport on mobile.
                <span className="min-w-0 truncate text-xs italic text-ink-muted">
                  {trimmedComment}
                </span>
              )}
            </div>
          )}

          {contextOpen && (
            <div>
              <label htmlFor={textareaId} className="sr-only">
                Extra context for: {question.statement}
              </label>
              <textarea
                id={textareaId}
                value={comment ?? ""}
                onChange={(e) => onCommentChange(e.target.value)}
                rows={3}
                maxLength={MAX_COMMENT_LENGTH}
                placeholder="Anything that would help us read this answer correctly. Optional."
                className="w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
              />
              <div className="mt-1 flex min-h-[1.5rem] items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setContextOpen(false)}
                  aria-expanded={true}
                  aria-controls={textareaId}
                  className="text-xs text-ink-muted hover:text-maroon cursor-pointer"
                >
                  Done
                </button>
                {remaining <= COUNTER_VISIBLE_WITHIN && (
                  <span aria-live="polite" className="text-xs text-ink-muted">
                    {remaining} characters left
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
