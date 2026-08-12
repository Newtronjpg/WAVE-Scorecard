"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Who gets emailed when someone finishes the assessment. Editable here
// rather than only in an environment variable so it can be changed
// without a redeploy, including by someone trying the demo who wants
// notifications to reach their own inbox.

export function NotifySettings({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: value }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save. Please try again.");
      setStatus("idle");
      return;
    }

    const data = await res.json();
    setValue(data.recipients);
    setStatus("saved");
    router.refresh();
    setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <form onSubmit={save} className="rounded-md border border-line p-4">
      <label htmlFor="notify" className="block text-sm font-medium text-ink">
        Email notifications
      </label>
      <p className="mt-1 text-sm text-ink-muted leading-relaxed">
        Who gets an email when someone completes the assessment. Separate
        several addresses with commas. Leave empty to turn notifications off.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id="notify"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="you@example.com, ben@example.com"
          className="min-w-0 flex-1 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-md bg-maroon px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red">{error}</p>}
      {status === "saved" && (
        <p className="mt-2 text-sm text-ink-muted">Saved.</p>
      )}
      {value.trim() === "" && status !== "saving" && !error && (
        <p className="mt-2 text-sm text-ink-muted">
          Notifications are currently off.
        </p>
      )}
    </form>
  );
}
