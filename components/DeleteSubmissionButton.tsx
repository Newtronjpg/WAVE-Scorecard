"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Two-step inline confirm rather than a browser confirm() dialog: a
// native dialog cannot be styled, and it blocks the page thread, which
// makes the admin table awkward to test end to end. Arming resets itself
// after a few seconds so a half-finished click cannot sit armed
// indefinitely and catch a later, unrelated click.

export function DeleteSubmissionButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }

    setDeleting(true);
    setError(false);

    const res = await fetch(`/api/admin/submissions/${id}`, { method: "DELETE" });

    if (!res.ok) {
      setError(true);
      setDeleting(false);
      setArmed(false);
      return;
    }

    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={deleting}
      aria-label={armed ? `Confirm deleting ${label}` : `Delete ${label}`}
      className={
        armed
          ? "rounded border border-maroon px-2 py-1 text-xs font-medium text-maroon cursor-pointer"
          : "rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink cursor-pointer"
      }
    >
      {deleting ? "Deleting…" : error ? "Failed" : armed ? "Confirm?" : "Delete"}
    </button>
  );
}
