"use client";

import {
  ADVISOR_AREAS,
  ADVISOR_NAME_PLACEHOLDER,
  ADVISOR_RATINGS,
  ADVISOR_SECTION_INTRO,
  MAX_ADVISOR_NAME_LENGTH,
  type AdvisorArea,
  type AdvisorRatings,
} from "@/lib/advisors";

// Built from the same parts as RatingSelector -- serif legend, rounded
// border-2 buttons that fill maroon when chosen -- rather than a dropdown or
// a star widget, so this reads as the same assessment rather than a survey
// bolted onto the end of one.
//
// Every control is optional and nothing is ever required, so there are no
// error states here at all: the only way to get this wrong is to be prevented
// from moving on, and that cannot happen.

export function AdvisorSection({
  value,
  onChange,
}: {
  value: AdvisorRatings;
  onChange: (next: AdvisorRatings) => void;
}) {
  function setRating(area: AdvisorArea, rating: number) {
    const current = value[area] ?? {};
    // Re-selecting clears it. Nothing else here can be un-answered, and there
    // is no other way back to "I did not say" once a button is tapped.
    const next = current.rating === rating ? undefined : rating;
    onChange({ ...value, [area]: { ...current, rating: next } });
  }

  function setName(area: AdvisorArea, name: string) {
    onChange({ ...value, [area]: { ...(value[area] ?? {}), name } });
  }

  return (
    <div className="mt-8 divide-y divide-line">
      <p className="pb-6 text-ink leading-relaxed">{ADVISOR_SECTION_INTRO}</p>

      {ADVISOR_AREAS.map((area) => {
        const entry = value[area.id] ?? {};
        return (
          <fieldset key={area.id} className="border-0 p-0 m-0 min-w-0 py-6 sm:py-7">
            <legend className="font-display text-lg sm:text-xl leading-snug text-ink mb-3">
              {area.label}
            </legend>

            <div
              role="radiogroup"
              aria-label={`${area.label} adviser relationship`}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              {ADVISOR_RATINGS.map((rating) => {
                const selected = entry.rating === rating.value;
                return (
                  <button
                    key={rating.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${area.label}: ${rating.label}`}
                    onClick={() => setRating(area.id, rating.value)}
                    className={[
                      "rounded-lg border-2 px-3 py-2.5 text-center text-sm font-medium",
                      "transition-colors duration-150 cursor-pointer",
                      selected
                        ? "bg-maroon text-white border-transparent"
                        : "bg-paper-raised border-line text-ink hover:border-red",
                    ].join(" ")}
                  >
                    {rating.label}
                  </button>
                );
              })}
            </div>

            <label htmlFor={`advisor-${area.id}`} className="sr-only">
              {area.label} adviser name
            </label>
            <input
              id={`advisor-${area.id}`}
              type="text"
              maxLength={MAX_ADVISOR_NAME_LENGTH}
              value={entry.name ?? ""}
              onChange={(e) => setName(area.id, e.target.value)}
              placeholder={ADVISOR_NAME_PLACEHOLDER}
              className="mt-3 block w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:border-maroon focus:outline-none"
            />
          </fieldset>
        );
      })}
    </div>
  );
}
