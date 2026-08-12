"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Question } from "@/lib/questions";

// Edits one question's wording: its statement and the five rating
// explanations a prospect reads when picking a number.
//
// Structure is not editable here and deliberately has no inputs: the
// question's id, its gap, and each level's Poor/Fair/Good/Excellent tier
// come from lib/questions.ts. That is what keeps an edit from being able
// to change a score or invalidate a stored submission.

interface LevelDraft {
  label: string;
  description: string;
}

export function QuestionEditor({
  question,
  edited,
}: {
  question: Question;
  edited: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState(question.statement);
  const [levels, setLevels] = useState<LevelDraft[]>(
    question.levels.map((l) => ({ label: l.label, description: l.description }))
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  function updateLevel(index: number, patch: Partial<LevelDraft>) {
    setLevels((current) =>
      current.map((level, i) => (i === index ? { ...level, ...patch } : level))
    );
  }

  async function save() {
    setStatus("saving");
    setError(null);

    const res = await fetch(`/api/admin/questions/${question.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement, levels }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save.");
      setStatus("idle");
      return;
    }

    setStatus("saved");
    router.refresh();
    setTimeout(() => setStatus("idle"), 2500);
  }

  async function reset() {
    setStatus("saving");
    setError(null);

    const res = await fetch(`/api/admin/questions/${question.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      setError("Could not reset.");
      setStatus("idle");
      return;
    }

    // The server now holds no override, so the page reload below brings
    // back the original wording. Collapsing avoids showing stale drafts.
    setStatus("idle");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="border-b border-line py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 text-left cursor-pointer"
      >
        <span className="mt-0.5 shrink-0 rounded bg-[var(--color-tint)] px-1.5 py-0.5 text-xs font-medium text-ink">
          {question.id}
        </span>
        <span className="flex-1 text-sm text-ink">{question.statement}</span>
        {edited && (
          <span className="shrink-0 text-xs text-ink-muted">edited</span>
        )}
        <span className="shrink-0 text-xs text-ink-muted">
          {open ? "Close" : "Edit"}
        </span>
      </button>

      {open && (
        <div className="mt-4 pl-2">
          <label className="block text-xs font-medium tracking-wide uppercase text-ink-muted">
            Statement
          </label>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
          />

          <p className="mt-4 text-xs font-medium tracking-wide uppercase text-ink-muted">
            What each rating means
          </p>

          {levels.map((level, index) => (
            <div key={index} className="mt-3 rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white">
                  {index + 1}
                </span>
                <span className="text-xs text-ink-muted">
                  {question.levels[index].tier}
                </span>
              </div>
              <input
                type="text"
                value={level.label}
                onChange={(e) => updateLevel(index, { label: e.target.value })}
                placeholder="Short label"
                className="mt-2 w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink focus:outline-none"
              />
              <textarea
                value={level.description}
                onChange={(e) =>
                  updateLevel(index, { description: e.target.value })
                }
                rows={2}
                placeholder="Full description"
                className="mt-2 w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink focus:outline-none"
              />
            </div>
          ))}

          {error && <p className="mt-3 text-sm text-red">{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={status === "saving"}
              className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
            >
              {status === "saving" ? "Saving…" : "Save"}
            </button>
            {edited && (
              <button
                type="button"
                onClick={reset}
                disabled={status === "saving"}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-40 cursor-pointer"
              >
                Reset to original
              </button>
            )}
            {status === "saved" && (
              <span className="text-sm text-ink-muted">Saved.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
