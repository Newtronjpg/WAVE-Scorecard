"use client";

import {
  FOLLOW_UP_CONFIRMATION,
  FOLLOW_UP_NO,
  FOLLOW_UP_QUESTION,
  FOLLOW_UP_YES,
} from "@/lib/followUp";

// Asked on the last section, just before the assessment is submitted, so
// the answer travels with the submission and lands in the one completion
// email rather than arriving separately after it.
//
// Fully controlled and free of any network call: the parent holds the
// value and sends it with everything else.

export function FollowUpPrompt({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  const selected = value === null ? "" : value ? "yes" : "no";

  return (
    <div className="mt-8 rounded-md border border-line bg-paper-raised px-5 py-4">
      <label htmlFor="followUp" className="block text-sm text-ink leading-relaxed">
        {FOLLOW_UP_QUESTION}
      </label>
      <select
        id="followUp"
        value={selected}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "yes")
        }
        className="mt-3 w-full sm:max-w-sm rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none"
      >
        <option value="">Select an option</option>
        <option value="yes">{FOLLOW_UP_YES}</option>
        <option value="no">{FOLLOW_UP_NO}</option>
      </select>

      {/* aria-live so the confirmation is announced, not merely shown. */}
      <div aria-live="polite">
        {value === true && (
          <p className="mt-3 border-l-2 border-maroon pl-3 text-sm text-ink leading-relaxed">
            {FOLLOW_UP_CONFIRMATION}
          </p>
        )}
      </div>
    </div>
  );
}
