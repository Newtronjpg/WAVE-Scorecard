"use client";

import { useEffect, useState } from "react";

// A minimal version history / rollback panel for the draft editor
// (components/QuestionSetEditor.tsx). Reads GET /api/admin/questions/versions
// (metadata only -- version, note, publishedAt) and lets an admin roll
// back to an older version via POST /api/admin/questions/rollback.
//
// Collapsed by default and only fetches once expanded: this is a recovery
// action, not part of the primary Save/Publish/Discard/Reset workflow, so
// it shouldn't cost every editor page load a query it usually won't need.
//
// Rolling back APPENDS a new version carrying the target's content
// forward -- app/api/admin/questions/rollback/route.ts never restores the
// old version number itself. `onRolledBack` is handed that new number so
// the parent's "Version N is live" header stays correct, and the list is
// re-fetched (rather than spliced locally) so it picks up the freshly
// created row with its real note and timestamp.

interface VersionSummary {
  version: number;
  note: string | null;
  publishedAt: string;
}

export function VersionHistory({
  publishedVersion,
  onRolledBack,
}: {
  publishedVersion: number | null;
  onRolledBack: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [armedVersion, setArmedVersion] = useState<number | null>(null);
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/questions/versions");
        if (!res.ok) {
          throw new Error();
        }
        const data = await res.json();
        if (!cancelled) {
          setVersions(data.versions);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to load version history:", e);
          setError("Could not load version history. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  function handleRollbackClick(version: number) {
    if (armedVersion !== version) {
      setArmedVersion(version);
      setTimeout(() => {
        setArmedVersion((current) => (current === version ? null : current));
      }, 4000);
      return;
    }
    setArmedVersion(null);
    confirmRollback(version);
  }

  async function confirmRollback(version: number) {
    setRollingBackVersion(version);
    setError(null);
    try {
      const res = await fetch("/api/admin/questions/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not roll back. Please try again.");
        return;
      }

      const data = await res.json();
      onRolledBack(data.version);
      // Force a re-fetch so the list picks up the new version row (its
      // real note and timestamp) rather than guessing at its shape here.
      setLoaded(false);
    } catch (e) {
      console.error("confirmRollback failed:", e);
      setError("Something went wrong. Please try again.");
    } finally {
      setRollingBackVersion(null);
    }
  }

  return (
    <div className="mt-6 rounded-md border border-line p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-ink-muted hover:text-ink cursor-pointer"
      >
        {open ? "Hide version history" : "Version history"}
      </button>
      <p className="mt-1 text-xs text-ink-muted">
        A bad publish is one click to undo -- roll back to any earlier
        version below. This appends a new version carrying that one&rsquo;s
        content forward; it does not delete anything from history.
      </p>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="text-sm text-ink-muted">Loading version history…</p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          )}

          {!loading && loaded && versions.length === 0 && (
            <p className="text-sm text-ink-muted">Nothing published yet.</p>
          )}

          {versions.length > 0 && (
            <ul className="divide-y divide-line">
              {versions.map((v) => {
                const isLive = v.version === publishedVersion;
                const armed = armedVersion === v.version;
                const busy = rollingBackVersion === v.version;
                const anyRollingBack = rollingBackVersion !== null;

                return (
                  <li
                    key={v.version}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div>
                      <p className="text-sm text-ink">
                        Version {v.version}
                        {isLive && (
                          <span className="ml-2 rounded bg-[var(--color-tint)] px-1.5 py-0.5 text-xs font-medium text-maroon">
                            Live
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {new Date(v.publishedAt).toLocaleString()}
                        {v.note ? ` — ${v.note}` : ""}
                      </p>
                    </div>

                    {!isLive && (
                      <button
                        type="button"
                        onClick={() => handleRollbackClick(v.version)}
                        disabled={anyRollingBack}
                        aria-label={
                          armed
                            ? `Confirm rolling back to version ${v.version}`
                            : `Roll back to version ${v.version}`
                        }
                        className={
                          armed
                            ? "rounded border border-maroon px-2 py-1 text-xs font-medium text-maroon disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            : "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        }
                      >
                        {busy
                          ? "Rolling back…"
                          : armed
                            ? "Confirm?"
                            : "Roll back to this version"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
