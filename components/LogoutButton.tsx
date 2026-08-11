"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.replace("/admin/login");
        router.refresh();
      }}
      className="text-sm text-ink-muted hover:text-ink underline shrink-0 cursor-pointer"
    >
      Log out
    </button>
  );
}
