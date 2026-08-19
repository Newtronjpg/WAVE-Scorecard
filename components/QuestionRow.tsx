"use client";

import { useState } from "react";
import { GAPS, type Gap } from "@/lib/questions";
import { tierForLevel } from "@/lib/scoring";
import {
  MIN_LEVELS,
  MAX_LEVELS,
  type StoredLevel,
  type StoredQuestion,
} from "@/lib/questionSet";

// One question in the draft editor: collapsed to its id and statement,
// expanding to full editing -- statement, gap, per-choice label,
// description, and read-only derived tier, add/remove choice, reorder
// within its gap, and delete.
//
// Fully controlled: this component holds no copy of the question's data,
// only UI-only state (open/collapsed, the delete confirm's armed flag).
// Every edit calls onChange with a brand-new StoredQuestion; the parent
// (QuestionSetEditor) owns the actual array and is the only place that
// persists anything.

// Values are always renumbered to 1..n by position, never trusted from
// existing data, so add/remove/reorder can never leave a gap in the
// sequence that validateQuestionSet would reject.
function renumbered(levels: StoredLevel[]): StoredLevel[] {
  return levels.map((level, i) => ({ ...level, value: i + 1 }));
}

export function QuestionRow({
  question,
  canMoveUp,
  canMoveDown,
  startOpen = false,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  question: StoredQuestion;
  canMoveUp: boolean;
  canMoveDown: boolean;
  startOpen?: boolean;
  onChange: (next: StoredQuestion) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [deleteArmed, setDeleteArmed] = useState(false);

  function updateLevel(index: number, patch: Partial<StoredLevel>) {
    onChange({
      ...question,
      levels: question.levels.map((level, i) =>
        i === index ? { ...level, ...patch } : level
      ),
    });
  }

  function addChoice() {
    onChange({
      ...question,
      levels: renumbered([
        ...question.levels,
        { value: question.levels.length + 1, label: "", description: "" },
      ]),
    });
  }

  function removeChoice() {
    // Always drops the LAST choice. Removing from the middle would leave
    // a hole in the value sequence that validateQuestionSet rejects;
    // dropping the last one and renumbering (a no-op here, since the
    // remaining values were already contiguous) sidesteps that entirely.
    onChange({
      ...question,
      levels: renumbered(question.levels.slice(0, -1)),
    });
  }

  // Two-step inline confirm matching components/DeleteSubmissionButton.tsx:
  // arms on the first click, executes on the second, and un-arms itself
  // after 4s so a stray later click can't land as a confirm.
  function handleDeleteClick() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    onDelete();
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
        <span className="flex-1 text-sm text-ink">
          {question.statement.trim().length > 0 ? (
            question.statement
          ) : (
            <span className="italic text-ink-muted">(empty statement)</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          {question.levels.length} choices
        </span>
        <span className="shrink-0 text-xs text-ink-muted">
          {open ? "Close" : "Edit"}
        </span>
      </button>

      {open && (
        <div className="mt-4 pl-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                aria-label={`Move ${question.id} up`}
                className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                &uarr;
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                aria-label={`Move ${question.id} down`}
                className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                &darr;
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Gap
              <select
                value={question.gap}
                onChange={(e) =>
                  onChange({ ...question, gap: e.target.value as Gap })
                }
                className="rounded-md border border-line bg-paper-raised px-2 py-1.5 text-sm text-ink focus:outline-none"
              >
                {GAPS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={handleDeleteClick}
              aria-label={
                deleteArmed
                  ? `Confirm deleting ${question.id}`
                  : `Delete ${question.id}`
              }
              className={
                deleteArmed
                  ? "ml-auto rounded border border-maroon px-2 py-1 text-xs font-medium text-maroon cursor-pointer"
                  : "ml-auto rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink cursor-pointer"
              }
            >
              {deleteArmed ? "Confirm?" : "Delete question"}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Deleting removes {question.id} from the draft. Answers already
            recorded against it stay in past submissions, but stop appearing
            in the summary export.
          </p>

          <label className="mt-4 block text-xs font-medium tracking-wide uppercase text-ink-muted">
            Statement
          </label>
          <textarea
            value={question.statement}
            onChange={(e) =>
              onChange({ ...question, statement: e.target.value })
            }
            rows={2}
            className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
          />

          {question.levels.length === 2 && (
            <p role="status" className="mt-2 text-xs text-maroon">
              With two choices this question can only score 0 or 100, so it
              moves its section score more than any other question. Three or
              more is usually better.
            </p>
          )}

          <p className="mt-4 text-xs font-medium tracking-wide uppercase text-ink-muted">
            What each rating means
          </p>

          {question.levels.map((level, index) => (
            <div key={index} className="mt-3 rounded-md border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white">
                  {index + 1}
                </span>
                <span className="text-xs text-ink-muted">
                  {tierForLevel(level.value, question.levels.length)}
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

          <div className="mt-3 flex flex-wrap gap-2">
            {question.levels.length < MAX_LEVELS && (
              <button
                type="button"
                onClick={addChoice}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink cursor-pointer"
              >
                Add choice
              </button>
            )}
            {question.levels.length > MIN_LEVELS && (
              <button
                type="button"
                onClick={removeChoice}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink cursor-pointer"
              >
                Remove choice
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
