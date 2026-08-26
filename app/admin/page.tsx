import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { LogoutButton } from "@/components/LogoutButton";
import { NotifySettings } from "@/components/NotifySettings";
import { DeleteSubmissionButton } from "@/components/DeleteSubmissionButton";
import { ADMIN_COOKIE_NAME, matchAdminUser } from "@/lib/adminAuth";
import { getNotifyRecipientsRaw } from "@/lib/settings";
import { commentCount } from "@/lib/comments";

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
              <th className="px-3 py-2 font-medium">Industry</th>
              <th className="px-3 py-2 font-medium">Email</th>
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
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {s.companyName ?? "-"}
                    {commentCount(s.comments) > 0 && (
                      // The notes themselves only exist in the per-run
                      // export, so without a marker here nobody knows there
                      // is anything to open.
                      <span
                        title={`${commentCount(s.comments)} ${
                          commentCount(s.comments) === 1 ? "question has" : "questions have"
                        } added context, see the export`}
                        aria-label={`${commentCount(s.comments)} ${
                          commentCount(s.comments) === 1 ? "question has" : "questions have"
                        } added context`}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--color-tint)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-maroon"
                      >
                        <span aria-hidden="true">&#9998;</span>
                        {commentCount(s.comments)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-muted">{s.industry ?? "-"}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {s.email ? (
                    <a href={`mailto:${s.email}`} className="hover:underline">
                      {s.email}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2 text-right">{s.wealthScore}</td>
                <td className="px-3 py-2 text-right">{s.accountingScore}</td>
                <td className="px-3 py-2 text-right">{s.valueScore}</td>
                <td className="px-3 py-2 text-right">{s.earningsScore}</td>
                <td className="px-3 py-2 text-right font-medium">{s.overallScore}</td>
                <td className="px-3 py-2 text-ink-muted">{s.readinessBand}</td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={`/api/admin/submissions/${s.id}/export`}
                    className="mr-3 text-sm text-maroon hover:underline"
                  >
                    Export
                  </a>
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
        The Excel download above lists scores only. For one run&rsquo;s full
        answers, with the questions exactly as they were asked at the time, use
        Export on that row.
      </p>
    </div>
  );
}
