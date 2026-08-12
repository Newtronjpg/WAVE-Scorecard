import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { LogoutButton } from "@/components/LogoutButton";
import { NotifySettings } from "@/components/NotifySettings";
import { DeleteSubmissionButton } from "@/components/DeleteSubmissionButton";
import { ADMIN_COOKIE_NAME, matchAdminUser } from "@/lib/adminAuth";
import { getNotifyRecipientsRaw } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const passcode = cookieStore.get(ADMIN_COOKIE_NAME)?.value ?? "";
  // proxy.ts already guarantees this request has a valid passcode before
  // the page ever renders; re-resolving it here isn't re-checking access,
  // it's just recovering WHICH staff member that passcode belongs to, so
  // the page can say who's logged in.
  const user = matchAdminUser(passcode);

  const submissions = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
  });

  const notifyRecipients = await getNotifyRecipientsRaw();

  const average =
    submissions.length > 0
      ? Math.round(
          submissions.reduce((sum, s) => sum + s.overallScore, 0) /
            submissions.length
        )
      : null;

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-widest uppercase text-ink-muted font-medium">
            Internal
          </p>
          <h1 className="font-display text-3xl text-ink mt-1">
            WAVE Scorecard submissions
          </h1>
        </div>
        <div className="text-right shrink-0">
          {user && (
            <p className="text-sm text-ink-muted">
              Logged in as <span className="font-medium text-ink">{user.name}</span>
            </p>
          )}
          <LogoutButton />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="block font-display text-2xl text-maroon">
            {submissions.length}
          </span>
          <span className="text-ink-muted">Total submissions</span>
        </div>
        <div>
          <span className="block font-display text-2xl text-maroon">
            {average ?? "-"}
          </span>
          <span className="text-ink-muted">Average score</span>
        </div>
      </div>

      <div className="mt-8">
        <NotifySettings initial={notifyRecipients} />
      </div>

      <div className="mt-4">
        <Link
          href="/admin/questions"
          className="text-sm text-maroon hover:underline"
        >
          Edit questions and rating descriptions &rarr;
        </Link>
      </div>

      <a
        href="/api/admin/export"
        className="mt-6 inline-flex items-center rounded-md bg-maroon px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-maroon-dark)]"
      >
        Download Excel (.xlsx)
      </a>

      <div className="mt-8 overflow-x-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-tint)] text-left">
              <th className="px-3 py-2 font-medium">Submitted</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium text-right">Wealth</th>
              <th className="px-3 py-2 font-medium text-right">Accounting</th>
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">Earnings</th>
              <th className="px-3 py-2 font-medium text-right">Overall</th>
              <th className="px-3 py-2 font-medium">Band</th>
              <th className="px-3 py-2 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {submissions.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                  {s.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">{s.prospectName ?? "-"}</td>
                <td className="px-3 py-2">{s.companyName ?? "-"}</td>
                <td className="px-3 py-2 text-right">{s.wealthScore}</td>
                <td className="px-3 py-2 text-right">{s.accountingScore}</td>
                <td className="px-3 py-2 text-right">{s.valueScore}</td>
                <td className="px-3 py-2 text-right">{s.earningsScore}</td>
                <td className="px-3 py-2 text-right font-medium">{s.overallScore}</td>
                <td className="px-3 py-2 text-ink-muted">{s.readinessBand}</td>
                <td className="px-3 py-2 text-right">
                  <DeleteSubmissionButton
                    id={s.id}
                    label={`${s.prospectName ?? "this submission"}`}
                  />
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink-muted">
                  No submissions yet. They&rsquo;ll show up here as soon as someone
                  finishes the assessment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Raw answers for every question are in the Excel export, not in this table.
      </p>
    </div>
  );
}
