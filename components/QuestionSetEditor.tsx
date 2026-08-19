"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GAPS, type Gap } from "@/lib/questions";
import {
  validateQuestionSet,
  nextQuestionId,
  type StoredQuestion,
} from "@/lib/questionSet";
import { QuestionRow } from "./QuestionRow";
import { ScoringCheck } from "./ScoringCheck";
import { VersionHistory } from "./VersionHistory";

type BusyAction = "save" | "publish" | "reset" | "reload" | null;

// Owns the whole draft as one array in memory. Add/delete/reorder/change-
// choice-count are all just producing a new array and calling setQuestions
// -- that's what keeps them atomic once Save draft actually persists it.
//
// Client-side validation (validateQuestionSet, same function the server
// runs) is for feedback only: it disables Publish and shows named
// problems, but the server re-validates on every save and publish
// regardless. A bypassed or stale client check can never let bad content
// through -- it can only produce a worse error message.
export function QuestionSetEditor({
  initialQuestions,
  initialUpdatedAt,
  publishedVersion: initialPublishedVersion,
}: {
  initialQuestions: StoredQuestion[];
  initialUpdatedAt: string;
  publishedVersion: number | null;
}) {
  const [questions, setQuestions] = useState<StoredQuestion[]>(initialQuestions);
  // The last-saved-or-loaded snapshot: what "Discard changes" reverts to,
  // and what `dirty` below is measured against.
  const [savedQuestions, setSavedQuestions] = useState<StoredQuestion[]>(
    initialQuestions
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(
    initialPublishedVersion
  );

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set only on a 409 from the draft PUT -- distinct from a generic error
  // because it gets its own "Reload" affordance, and because auto-reloading
  // on it would discard whatever the admin was mid-typing.
  const [conflict, setConflict] = useState(false);
  // Set when a GET of the draft reports source "draft" with updatedAt
  // null -- the one combination that means the saved draft row exists but
  // could not be read cleanly (fails validation, or the read itself
  // failed), as opposed to "no draft has ever been saved". Surfaced so an
  // admin never mistakes "nothing to conflict with" for "there is real,
  // unreadable content sitting under this save."
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  const [publishArmed, setPublishArmed] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const [resetLiveArmed, setResetLiveArmed] = useState(false);
  // Two-step confirm for Reload/Discard, matching DeleteSubmissionButton's
  // arm-then-confirm-within-4s pattern -- both actions can silently
  // destroy unsaved edits with a single click otherwise. Reload only
  // requires arming when there's something to lose (dirty); Discard is
  // only ever enabled when dirty, so it always requires it.
  const [reloadArmed, setReloadArmed] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);

  // A newly added question opens itself so there's somewhere to type
  // immediately, without an extra click to expand it.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);

  const validation = useMemo(() => validateQuestionSet(questions), [questions]);
  const problems = validation.ok ? [] : validation.errors;

  const dirty = useMemo(
    () => JSON.stringify(questions) !== JSON.stringify(savedQuestions),
    [questions, savedQuestions]
  );

  const busy = busyAction !== null;

  function clearTransient() {
    setError(null);
    setMessage(null);
    setConflict(false);
  }

  async function saveDraft(): Promise<boolean> {
    setBusyAction("save");
    clearTransient();

    try {
      const res = await fetch("/api/admin/questions/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Always echo the updatedAt this editor most recently loaded or
        // saved. Once a draft row exists, the server 409s on anything else
        // (omitted, null, or stale) -- see app/api/admin/questions/draft/route.ts.
        body: JSON.stringify({ questions, updatedAt }),
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        setConflict(true);
        setError(
          data?.error ??
            "Someone else changed the draft while you were editing. Reload to get their changes before saving."
        );
        setBusyAction(null);
        return false;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not save. Please try again.");
        setBusyAction(null);
        return false;
      }

      const data = await res.json();
      setUpdatedAt(data.updatedAt);
      setSavedQuestions(questions);
      setDraftWarning(null);
      setMessage("Saved.");
      setBusyAction(null);
      setTimeout(() => setMessage((m) => (m === "Saved." ? null : m)), 2500);
      return true;
    } catch (e) {
      // fetch() itself rejects (not just resolves with !res.ok) on a
      // transport failure -- server restarted, wifi dropped, a cold-start
      // timeout -- and res.json() rejects if a 2xx body isn't valid JSON.
      // Either would otherwise throw unhandled here, skip every line
      // below, and leave busyAction stuck forever: every button
      // (including this one) permanently disabled with no error shown and
      // no way out but a page reload that discards the unsaved edit. Not
      // distinguishing network vs parse failures here -- both get the
      // same honest "try again", which is all either warrants.
      console.error("saveDraft failed:", e);
      setError("Something went wrong. Please try again.");
      setBusyAction(null);
      return false;
    }
  }

  // Re-reads the draft from the server. Used both for the 409 banner's
  // "Reload" action and after Reset to factory, which doesn't return the
  // new content itself.
  async function reloadDraft() {
    setBusyAction("reload");
    clearTransient();

    try {
      const res = await fetch("/api/admin/questions/draft");
      if (!res.ok) {
        setError("Could not reload the draft. Please try again.");
        setBusyAction(null);
        return;
      }

      const data = await res.json();
      setQuestions(data.questions);
      setSavedQuestions(data.questions);
      setUpdatedAt(data.updatedAt);
      setPublishedVersion(data.publishedVersion);
      setDraftWarning(
        data.source === "draft" && data.updatedAt === null
          ? "The saved draft could not be read cleanly and may be corrupted. What's shown below is the live version instead -- review carefully before saving over it."
          : null
      );
      setBusyAction(null);
    } catch (e) {
      // See saveDraft's comment: fetch/res.json() can both reject, and an
      // unhandled rejection here would leave busyAction stuck forever too.
      console.error("reloadDraft failed:", e);
      setError("Something went wrong. Please try again.");
      setBusyAction(null);
    }
  }

  function discardChanges() {
    setQuestions(savedQuestions);
    clearTransient();
  }

  // Discard is only ever clickable when dirty (see discardDisabled below),
  // so this always arms first -- there is always something real to lose.
  function handleDiscardClick() {
    if (!discardArmed) {
      setDiscardArmed(true);
      setTimeout(() => setDiscardArmed(false), 4000);
      return;
    }
    setDiscardArmed(false);
    discardChanges();
  }

  // Reload overwrites BOTH `questions` and `savedQuestions`, so a dirty
  // admin has no way back afterward (Discard can't help -- its own
  // snapshot was just replaced too). Only require the arm/confirm step
  // when there's actually unsaved work to lose; a clean Reload has
  // nothing to destroy and arming it would just be an annoying extra
  // click.
  function handleReloadClick() {
    if (!dirty) {
      reloadDraft();
      return;
    }
    if (!reloadArmed) {
      setReloadArmed(true);
      setTimeout(() => setReloadArmed(false), 4000);
      return;
    }
    setReloadArmed(false);
    reloadDraft();
  }

  async function confirmPublish() {
    setBusyAction("publish");
    clearTransient();

    try {
      const res = await fetch("/api/admin/questions/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          publishNote.trim().length > 0 ? { note: publishNote.trim() } : {}
        ),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // Covers the "Save the draft before publishing." 400 from a draft
        // row that has never been saved -- the API's message is already
        // exactly right to show verbatim.
        setError(data?.error ?? "Could not publish. Please try again.");
        setBusyAction(null);
        setPublishArmed(false);
        return;
      }

      const data = await res.json();
      setPublishedVersion(data.version);
      setMessage(`Published as version ${data.version}.`);
      setBusyAction(null);
      setPublishArmed(false);
      setPublishNote("");
    } catch (e) {
      // See saveDraft's comment.
      console.error("confirmPublish failed:", e);
      setError("Something went wrong. Please try again.");
      setBusyAction(null);
      setPublishArmed(false);
    }
  }

  async function confirmReset(to: "live" | "factory") {
    setBusyAction("reset");
    clearTransient();

    try {
      const res = await fetch("/api/admin/questions/reset-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not reset. Please try again.");
        setBusyAction(null);
        setResetArmed(false);
        setResetLiveArmed(false);
        return;
      }

      setResetArmed(false);
      setResetLiveArmed(false);
      // reset-draft doesn't return the new content, only { ok: true } --
      // read it back so the editor shows exactly what's now persisted.
      // reloadDraft manages its own busyAction lifecycle end-to-end (and
      // is itself exception-safe now), so busyAction is deliberately not
      // cleared here first -- it stays continuously busy through
      // reset -> reload instead of flashing to enabled in between.
      await reloadDraft();
    } catch (e) {
      // See saveDraft's comment. Only the reset-draft fetch itself can
      // land here -- reloadDraft has its own try/catch and never throws.
      console.error("confirmReset failed:", e);
      setError("Something went wrong. Please try again.");
      setBusyAction(null);
      setResetArmed(false);
      setResetLiveArmed(false);
    }
  }

  function updateQuestion(id: string, next: StoredQuestion) {
    setQuestions((current) => current.map((q) => (q.id === id ? next : q)));
  }

  function deleteQuestion(id: string) {
    setQuestions((current) => current.filter((q) => q.id !== id));
  }

  // Drag-and-drop reorder: drops the dragged question immediately before
  // wherever the target question currently sits in the underlying array.
  // Only meaningful within a gap -- a question's gap is set from the
  // dropdown, not by dragging it into a different section -- so this is a
  // no-op across gaps rather than silently reassigning one.
  function reorderQuestion(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setQuestions((current) => {
      const fromIdx = current.findIndex((q) => q.id === draggedId);
      const target = current.find((q) => q.id === targetId);
      if (fromIdx === -1 || !target) return current;
      if (current[fromIdx].gap !== target.gap) return current;

      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      const insertAt = next.findIndex((q) => q.id === targetId);
      next.splice(insertAt, 0, moved);
      return next;
    });
  }

  function addQuestion(gap: Gap) {
    // Computed against the current render's `questions`, not a functional
    // updater, because the new id has to be known synchronously to also
    // seed justAddedId -- and a setState updater function is expected to
    // be pure, so triggering a second state update from inside one is the
    // wrong tool here even though it would usually work.
    const id = nextQuestionId(questions, gap);
    const newQuestion: StoredQuestion = {
      id,
      gap,
      statement: "",
      // Four choices by default: it's the one count that maps onto the
      // four tier names (Poor/Fair/Good/Excellent) with no level sharing
      // a tier with another.
      levels: [1, 2, 3, 4].map((v) => ({ value: v, label: "", description: "" })),
    };
    setQuestions((current) => [...current, newQuestion]);
    setJustAddedId(id);
  }

  const saveDisabled = busy || !dirty;
  const publishDisabled = busy || dirty || problems.length > 0 || updatedAt === null;
  const discardDisabled = busy || !dirty;

  return (
    <div>
      <div className="mt-8 rounded-md border border-line p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm text-ink">
              {questions.length} question{questions.length === 1 ? "" : "s"} in
              this draft.
            </p>
            <p className="text-sm text-ink-muted">
              {publishedVersion === null
                ? "Nothing published yet."
                : `Version ${publishedVersion} is live.`}
              {dirty && " You have unsaved changes."}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveDraft}
            disabled={saveDisabled}
            className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {busyAction === "save" ? "Saving…" : "Save draft"}
          </button>

          {!publishArmed && (
            <button
              type="button"
              onClick={() => setPublishArmed(true)}
              disabled={publishDisabled}
              className="rounded-md border border-maroon px-4 py-2 text-sm font-medium text-maroon disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Publish
            </button>
          )}

          <button
            type="button"
            onClick={handleDiscardClick}
            disabled={discardDisabled}
            aria-label={discardArmed ? "Confirm discarding changes" : "Discard changes"}
            className={
              discardArmed
                ? "rounded-md border border-maroon px-4 py-2 text-sm font-medium text-maroon disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                : "rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            }
          >
            {discardArmed ? "Confirm? This discards your unsaved edits" : "Discard changes"}
          </button>

          {!resetLiveArmed && (
            <button
              type="button"
              onClick={() => setResetLiveArmed(true)}
              disabled={busy}
              className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Load what&rsquo;s live into draft
            </button>
          )}

          {!resetArmed && (
            <button
              type="button"
              onClick={() => setResetArmed(true)}
              disabled={busy}
              className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Reset to factory
            </button>
          )}

          <Link
            href="/admin/preview"
            target="_blank"
            className="text-sm text-maroon hover:underline"
          >
            Open /admin/preview &rarr;
          </Link>

          {message && <span className="text-sm text-ink-muted">{message}</span>}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Preview scores against the saved draft, not whatever&rsquo;s currently
          unsaved here -- save first if you want the preview to reflect
          these edits.
        </p>

        {resetLiveArmed && (
          <div className="mt-3 rounded-md border border-maroon p-3">
            <p className="text-sm text-ink">
              This throws away the current draft (including anything
              unsaved) and replaces it with whatever&rsquo;s currently live
              -- version {publishedVersion ?? "none"}. Use this after a
              rollback or a publish elsewhere if you want the editor to
              match what a prospect actually sees right now.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => confirmReset("live")}
                disabled={busy}
                className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
              >
                {busyAction === "reset" ? "Loading…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setResetLiveArmed(false)}
                disabled={busy}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {resetArmed && (
          <div className="mt-3 rounded-md border border-maroon p-3">
            <p className="text-sm text-ink">
              This throws away the current draft (including anything
              unsaved) and replaces it with the shipped factory question
              set. The live assessment is unaffected until you publish
              again.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => confirmReset("factory")}
                disabled={busy}
                className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
              >
                {busyAction === "reset" ? "Resetting…" : "Confirm reset"}
              </button>
              <button
                type="button"
                onClick={() => setResetArmed(false)}
                disabled={busy}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {publishArmed && (
          <div className="mt-3 rounded-md border border-maroon p-3">
            <p className="text-sm text-ink">
              This publishes {questions.length} question
              {questions.length === 1 ? "" : "s"} across {GAPS.length} gaps as
              version {(publishedVersion ?? 0) + 1}, the new live assessment.
              {publishedVersion !== null &&
                ` Version ${publishedVersion} stays in history and can be rolled back to.`}
            </p>
            <label className="mt-2 block text-xs font-medium tracking-wide uppercase text-ink-muted">
              Note (optional)
            </label>
            <input
              type="text"
              value={publishNote}
              onChange={(e) => setPublishNote(e.target.value)}
              placeholder="What changed?"
              className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={confirmPublish}
                disabled={busy}
                className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
              >
                {busyAction === "publish" ? "Publishing…" : "Confirm publish"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPublishArmed(false);
                  setPublishNote("");
                }}
                disabled={busy}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-muted hover:text-ink cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className="mt-4 rounded-md border border-red bg-[var(--color-tint)] px-4 py-3">
            <p className="text-sm font-medium text-ink">
              Publish is disabled until these are fixed:
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-muted">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {dirty && problems.length === 0 && (
          <p className="mt-3 text-sm text-ink-muted">
            Save your changes before publishing -- Publish always ships
            whatever was last saved, not what&rsquo;s on screen.
          </p>
        )}

        {draftWarning && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-maroon bg-[var(--color-tint)] px-4 py-3"
          >
            <p className="text-sm text-ink">{draftWarning}</p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red bg-[var(--color-tint)] px-4 py-3"
          >
            <p className="text-sm text-ink">{error}</p>
            {conflict && (
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={busy}
                aria-label={
                  dirty && reloadArmed
                    ? "Confirm reloading the draft"
                    : "Reload draft"
                }
                className={
                  dirty && reloadArmed
                    ? "mt-2 rounded-md border border-maroon px-3 py-1.5 text-xs font-medium text-maroon cursor-pointer"
                    : "mt-2 rounded-md border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink cursor-pointer"
                }
              >
                {busyAction === "reload"
                  ? "Reloading…"
                  : dirty && reloadArmed
                    ? "Confirm? This discards your unsaved edits"
                    : "Reload draft"}
              </button>
            )}
          </div>
        )}

        <ScoringCheck questions={questions} />
      </div>

      {GAPS.map((gapMeta) => {
        const gapQuestions = questions.filter((q) => q.gap === gapMeta.id);
        return (
          <section key={gapMeta.id} className="mt-10">
            <h2 className="font-display text-xl text-maroon">{gapMeta.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">{gapMeta.tagline}</p>

            <div className="mt-4 border-t border-line">
              {gapQuestions.map((question) => (
                <QuestionRow
                  key={question.id}
                  question={question}
                  startOpen={question.id === justAddedId}
                  onChange={(next) => updateQuestion(question.id, next)}
                  onDelete={() => deleteQuestion(question.id)}
                  dragging={draggedQuestionId === question.id}
                  onDragStart={() => setDraggedQuestionId(question.id)}
                  onDragEnd={() => setDraggedQuestionId(null)}
                  onDropOnto={() => {
                    if (draggedQuestionId) reorderQuestion(draggedQuestionId, question.id);
                    setDraggedQuestionId(null);
                  }}
                />
              ))}
              {gapQuestions.length === 0 && (
                <p className="py-3 text-sm text-ink-muted">
                  No questions in this gap yet. Every gap needs at least one
                  before you can publish.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => addQuestion(gapMeta.id)}
              className="mt-3 rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink cursor-pointer"
            >
              Add question to {gapMeta.name}
            </button>
          </section>
        );
      })}

      <VersionHistory
        publishedVersion={publishedVersion}
        onRolledBack={(version) => setPublishedVersion(version)}
      />
    </div>
  );
}
