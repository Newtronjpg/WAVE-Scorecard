"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("That passcode didn't work.");
      return;
    }
    router.replace(params.get("from") || "/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm px-5 py-20">
      <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
        Faulk &amp; Winkler
      </p>
      <h1 className="font-display text-2xl text-ink mt-2">Admin access</h1>
      <p className="text-sm text-ink-muted mt-2">
        Enter the passcode to view submitted assessments and download the export.
      </p>
      <form onSubmit={handleSubmit} className="mt-6">
        <input
          type="password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="w-full rounded-md border border-line bg-paper-raised px-3 py-2.5 text-ink focus:outline-none"
          placeholder="Passcode"
        />
        {error && <p className="mt-2 text-sm text-red">{error}</p>}
        <button
          type="submit"
          disabled={loading || passcode.length === 0}
          className="mt-4 w-full rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 cursor-pointer"
        >
          {loading ? "Checking\u2026" : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
