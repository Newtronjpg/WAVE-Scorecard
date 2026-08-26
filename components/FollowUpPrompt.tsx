"use client";

import {
  FOLLOW_UP_CONFIRMATION,
  FOLLOW_UP_NO,
  FOLLOW_UP_QUESTION,
  FOLLOW_UP_YES,
} from "@/lib/followUp";

// Asked on the last section, just before the assessment is submitted, so
// the answer travels with the submission and reaches staff in the one
// completion email.
//
// Built from the same parts as RatingSelector rather than a native
// <select>: a serif legend, rounded border-2 buttons that fill maroon
// when chosen, and the bordered caption strip underneath. A browser
// dropdown renders in system chrome, which reads as a form bolted onto
// the end of an assessment that has no other dropdowns in it.
//
// Fully controlled and free of any network call -- the parent holds the
// value and sends it with everything else.

const OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: FOLLOW_UP_YES },
  { value: false, label: FOLLOW_UP_NO },
];

export function FollowUpPrompt({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <fieldset className="border-0 p-0 m-0 min-w-0">
      <legend className="font-display text-lg sm:text-xl leading-snug text-ink mb-4">
        {FOLLOW_UP_QUESTION}
      </legend>

      <div
        role="radiogroup"
        aria-label={FOLLOW_UP_QUESTION}
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={selected}
              // Re-selecting clears the answer. Nothing else here can be
              // un-answered, but this one is optional, and there is no
              // other way back to "prefer not to say" once tapped.
              onClick={() => onChange(selected ? null : option.value)}
              className={[
                "flex items-center justify-center rounded-lg border-2 px-4 py-3 text-center",
                "text-sm font-medium leading-snug",
                "transition-colors duration-150 cursor-pointer",
                selected
                  ? "bg-maroon text-white border-transparent"
                  : "bg-paper-raised border-line text-ink hover:border-red",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Same caption strip the rating questions use, so the answered and
          unanswered states occupy identical height and nothing below
          shifts when someone picks an option. */}
      <div
        aria-live="polite"
        className={[
          "mt-3 min-h-[2.75rem] border-l-2 pl-3 py-1 text-sm text-ink-muted",
          value === null ? "border-line" : "border-maroon",
        ].join(" ")}
      >
        {value === true ? (
          <span className="text-ink">{FOLLOW_UP_CONFIRMATION}</span>
        ) : value === false ? (
          <span>No problem &mdash; your results are yours to keep either way.</span>
        ) : (
          <span className="italic">Optional.</span>
        )}
      </div>
    </fieldset>
  );
}
