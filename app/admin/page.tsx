import { db } from "@/lib/db";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const submissions = await db.submission.findMany({
    orderBy: { createdAt: "desc" },
  });

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
            Faulk &amp; Winkler &middot; Internal
          </p>
          <h1 className="font-display text-3xl text-ink mt-1">
            WAVE Scorecard submissions
          </h1>
        </div>
        <LogoutButton />
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
            {average ?? "\u2014"}
          </span>
          <span className="text-ink-muted">Average score</span>
        </div>
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
            <tr className="bg-[var(--color-tier-poor)] text-left">
              <th className="px-3 py-2 font-medium">Submitted</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium text-right">Wealth</th>
              <th className="px-3 py-2 font-medium text-right">Accounting</th>
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">Earnings</th>
              <th className="px-3 py-2 font-medium text-right">Overall</th>
              <th className="px-3 py-2 font-medium">Band</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {submissions.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                  {s.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="px-3 py-2">{s.prospectName ?? "\u2014"}</td>
                <td className="px-3 py-2">{s.companyName ?? "\u2014"}</td>
                <td className="px-3 py-2 text-right">{s.wealthScore}</td>
                <td className="px-3 py-2 text-right">{s.accountingScore}</td>
                <td className="px-3 py-2 text-right">{s.valueScore}</td>
                <td className="px-3 py-2 text-right">{s.earningsScore}</td>
                <td className="px-3 py-2 text-right font-medium">{s.overallScore}</td>
                <td className="px-3 py-2 text-ink-muted">{s.readinessBand}</td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-ink-muted">
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
