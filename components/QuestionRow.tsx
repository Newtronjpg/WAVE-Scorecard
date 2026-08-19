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
  startOpen = false,
  onChange,
  onDelete,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOnto,
}: {
  question: StoredQuestion;
  startOpen?: boolean;
  onChange: (next: StoredQuestion) => void;
  onDelete: () => void;
  // Reordering this question among its gap siblings by dragging. The
  // handle (not the whole row) carries `draggable`, so a drag can never be
  // confused with the click that expands/collapses the row.
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOnto: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [draggedChoiceIndex, setDraggedChoiceIndex] = useState<number | null>(null);

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

  // Removes the choice at any position, not just the last one -- renumbered
  // afterward closes whatever gap that leaves, so the remaining values stay
  // contiguous 1..n regardless of which one was removed.
  function removeChoiceAt(index: number) {
    onChange({
      ...question,
      levels: renumbered(question.levels.filter((_, i) => i !== index)),
    });
  }

  // Moves the choice at `from` to sit right before whatever is currently
  // at `to`, then renumbers -- same pattern as removeChoiceAt, so a
  // reordered choice's rating value always matches its new position, not
  // whatever it was labeled before the drag.
  function reorderChoice(from: number, to: number) {
    if (from === to) return;
    const next = [...question.levels];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ ...question, levels: renumbered(next) });
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
    <div
      className={
        dragging
          ? "border-b border-line py-3 opacity-40"
          : "border-b border-line py-3"
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnto();
      }}
    >
      <div className="flex items-start gap-3">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-label={`Drag to reorder ${question.id}`}
          title="Drag to reorder"
          className="mt-1 shrink-0 cursor-grab text-ink-muted select-none active:cursor-grabbing"
        >
          ⠿
        </span>
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
      </div>

      {open && (
        <div className="mt-4 pl-2">
          <div className="flex flex-wrap items-center gap-3">
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
            <div
              key={index}
              className={
                draggedChoiceIndex === index
                  ? "mt-2 flex items-start gap-2 opacity-40"
                  : "mt-2 flex items-start gap-2"
              }
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedChoiceIndex !== null) reorderChoice(draggedChoiceIndex, index);
                setDraggedChoiceIndex(null);
              }}
            >
              <div className="mt-2 flex w-8 shrink-0 flex-col items-center gap-1">
                <span
                  draggable
                  onDragStart={() => setDraggedChoiceIndex(index)}
                  onDragEnd={() => setDraggedChoiceIndex(null)}
                  aria-label={`Drag to reorder choice ${index + 1}`}
                  title="Drag to reorder"
                  className="cursor-grab text-xs leading-none text-ink-muted select-none active:cursor-grabbing"
                >
                  ⠿
                </span>
                <span className="rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white">
                  {index + 1}
                </span>
                <span className="text-[10px] leading-tight text-ink-muted">
                  {tierForLevel(level.value, question.levels.length)}
                </span>
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={level.label}
                  onChange={(e) => updateLevel(index, { label: e.target.value })}
                  placeholder="Short label"
                  className="w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink focus:outline-none"
                />
                <textarea
                  value={level.description}
                  onChange={(e) =>
                    updateLevel(index, { description: e.target.value })
                  }
                  rows={2}
                  placeholder="Full description"
                  className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink focus:outline-none"
                />
              </div>
              {question.levels.length > MIN_LEVELS && (
                <button
                  type="button"
                  onClick={() => removeChoiceAt(index)}
                  aria-label={`Remove choice ${index + 1}`}
                  className="mt-1 shrink-0 rounded-full p-1 leading-none text-ink-muted hover:bg-[var(--color-tint)] hover:text-maroon cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {question.levels.length < MAX_LEVELS && (
            <div className="mt-2 flex items-start gap-2">
              <span className="w-8 shrink-0" aria-hidden="true" />
              <button
                type="button"
                onClick={addChoice}
                className="rounded-md border border-dashed border-line px-3 py-1 text-xs text-ink-muted hover:border-maroon hover:text-maroon cursor-pointer"
              >
                + Add choice
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
