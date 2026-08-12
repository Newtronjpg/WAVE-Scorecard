"use client";

import { useEffect } from "react";
import Link from "next/link";

// Replaces the framework's bare "This page couldn't load" screen, which
// shows a visitor nothing but an error digest.
//
// That default cost real debugging time once: a missing database table
// surfaced only as an opaque number, with the actual cause visible only
// in the server log. This at least tells the person what to do next, and
// records the digest so it can be matched against the runtime log.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-5 py-20">
      <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
        WAVE Scorecard
      </p>
      <h1 className="font-display text-2xl text-ink mt-2">
        Something went wrong on our end
      </h1>
      <p className="mt-3 text-sm text-ink-muted leading-relaxed">
        This isn&rsquo;t anything you did. The page couldn&rsquo;t load because of a
        problem on our side. Trying again often works, and if it doesn&rsquo;t,
        it&rsquo;s worth letting us know.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] cursor-pointer"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-ink hover:bg-paper-raised"
        >
          Start over
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 text-xs text-ink-muted">
          If you report this, include reference{" "}
          <span className="font-mono text-ink">{error.digest}</span> &mdash; it
          points us at the exact error in our logs.
        </p>
      )}
    </div>
  );
}
