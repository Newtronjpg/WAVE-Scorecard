import { GAPS } from "@/lib/questions";

interface IntroViewProps {
  prospectName: string;
  companyName: string;
  onProspectNameChange: (value: string) => void;
  onCompanyNameChange: (value: string) => void;
  onStart: () => void;
}

export function IntroView({
  prospectName,
  companyName,
  onProspectNameChange,
  onCompanyNameChange,
  onStart,
}: IntroViewProps) {
  const canStart = prospectName.trim().length > 0 && companyName.trim().length > 0;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
      <h1 className="font-display text-4xl sm:text-5xl text-red leading-[1.1]">
        WAVE Scorecard
      </h1>

      <p className="mt-6 text-ink leading-relaxed">
        Whether you plan to sell, bring on a partner, or hand the business to the
        next generation, the owners who come out ahead start years early. This
        assessment measures the distance between where your business is today and
        where it needs to be, across the four gaps that decide what you walk away
        with.
      </p>

      <div className="mt-8 divide-y divide-line border-y border-line">
        {GAPS.map((g) => (
          <div key={g.id} className="py-3.5 flex gap-4">
            <span className="font-display text-base text-maroon w-36 shrink-0">
              {g.name}
            </span>
            <span className="text-sm text-ink-muted">{g.description}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-ink-muted leading-relaxed">
        28 quick statements, about five minutes. Reviewed with your
        advisor and never shared outside the firm.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-ink-muted" htmlFor="prospectName">
            Name <span className="text-red">*</span>
          </label>
          <input
            id="prospectName"
            type="text"
            required
            aria-required="true"
            value={prospectName}
            onChange={(e) => onProspectNameChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
            placeholder="Jane Owner"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted" htmlFor="companyName">
            Company <span className="text-red">*</span>
          </label>
          <input
            id="companyName"
            type="text"
            required
            aria-required="true"
            value={companyName}
            onChange={(e) => onCompanyNameChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
            placeholder="Acme Fabrication, Inc."
          />
        </div>
      </div>

      <button
        type="button"
        disabled={!canStart}
        onClick={onStart}
        className="mt-8 w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-maroon px-6 py-3 text-white font-medium hover:bg-[var(--color-maroon-dark)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        Start the assessment
      </button>
      {!canStart && (
        <p className="mt-2 text-xs text-ink-muted">
          Enter your name and company to continue.
        </p>
      )}

      <p className="mt-10 text-xs text-ink-muted">
        An advisory diagnostic.
      </p>
    </div>
  );
}
