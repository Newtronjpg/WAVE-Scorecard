"use client";

import { useState } from "react";
import {
  FOLLOW_UP_CONFIRMATION,
  FOLLOW_UP_NO,
  FOLLOW_UP_QUESTION,
  FOLLOW_UP_YES,
} from "@/lib/followUp";

// Asks, on the results page, whether the respondent wants to talk.
//
// The answer is recorded by a second request, because this is rendered
// after the submission row already exists. `submissionId` is what the
// submit response handed back; without one (the write failed) the caller
// does not render this at all rather than offering a choice that cannot
// be recorded.

type Status = "idle" | "saving" | "saved" | "error";

export function FollowUpPrompt({ submissionId }: { submissionId: string }) {
  const [choice, setChoice] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleChange(value: string) {
    setChoice(value);
    if (value === "") return;

    setStatus("saving");
    try {
      const res = await fetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, interested: value === "yes" }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const saidYes = choice === "yes";

  return (
    <div className="mt-10 rounded-md border border-line bg-paper-raised px-5 py-4">
      <label
        htmlFor="followUp"
        className="block text-sm text-ink leading-relaxed"
      >
        {FOLLOW_UP_QUESTION}
      </label>
      <select
        id="followUp"
        value={choice}
        onChange={(e) => handleChange(e.target.value)}
        disabled={status === "saving"}
        className="mt-3 w-full sm:max-w-sm rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:outline-none disabled:opacity-60"
      >
        <option value="">Select an option</option>
        <option value="yes">{FOLLOW_UP_YES}</option>
        <option value="no">{FOLLOW_UP_NO}</option>
      </select>

      {/* aria-live so the confirmation is announced, not just shown. */}
      <div aria-live="polite">
        {saidYes && status !== "error" && (
          <p className="mt-3 border-l-2 border-maroon pl-3 text-sm text-ink leading-relaxed">
            {FOLLOW_UP_CONFIRMATION}
          </p>
        )}
        {status === "error" && (
          <p role="alert" className="mt-3 text-sm text-red leading-relaxed">
            We couldn&rsquo;t record that just now. Please let us know directly,
            or try selecting it again.
          </p>
        )}
      </div>
    </div>
  );
}
