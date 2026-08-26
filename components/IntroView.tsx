import { GAPS } from "@/lib/questions";
import {
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  MAX_EMAIL_LENGTH,
  MAX_INDUSTRY_LENGTH,
  isPlausibleEmail,
  resolveIndustry,
} from "@/lib/contact";

interface IntroViewProps {
  prospectName: string;
  companyName: string;
  email: string;
  industry: string;
  industryOther: string;
  onProspectNameChange: (value: string) => void;
  onCompanyNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onIndustryOtherChange: (value: string) => void;
  onStart: () => void;
}

export function IntroView({
  prospectName,
  companyName,
  email,
  industry,
  industryOther,
  onProspectNameChange,
  onCompanyNameChange,
  onEmailChange,
  onIndustryChange,
  onIndustryOtherChange,
  onStart,
}: IntroViewProps) {
  const emailOk = isPlausibleEmail(email.trim());
  // Empty when the pair is incomplete -- "Other" with no description
  // included, since that names no industry at all.
  const resolvedIndustry = resolveIndustry(industry, industryOther);
  const canStart =
    prospectName.trim().length > 0 &&
    companyName.trim().length > 0 &&
    emailOk &&
    resolvedIndustry.length > 0;

  // Only complain about a malformed address once they have typed enough
  // to have meant something; scolding someone mid-address is noise.
  const showEmailError = email.trim().length > 3 && !emailOk;

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
        <div>
          <label className="text-xs font-medium text-ink-muted" htmlFor="email">
            Email <span className="text-red">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            aria-required="true"
            aria-invalid={showEmailError}
            aria-describedby={showEmailError ? "email-error" : undefined}
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className={[
              "mt-1 w-full rounded-md border bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none",
              showEmailError ? "border-red" : "border-line",
            ].join(" ")}
            placeholder="jane@acmefabrication.com"
          />
          {showEmailError && (
            <p id="email-error" role="alert" className="mt-1 text-xs text-red">
              That doesn&rsquo;t look like a complete email address.
            </p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted" htmlFor="industry">
            Industry <span className="text-red">*</span>
          </label>
          <select
            id="industry"
            required
            aria-required="true"
            value={industry}
            onChange={(e) => onIndustryChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
          >
            <option value="">Select your industry</option>
            {INDUSTRY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {industry === INDUSTRY_OTHER && (
            <>
              <label htmlFor="industryOther" className="sr-only">
                Describe your industry
              </label>
              <input
                id="industryOther"
                type="text"
                required
                aria-required="true"
                maxLength={MAX_INDUSTRY_LENGTH}
                value={industryOther}
                onChange={(e) => onIndustryOtherChange(e.target.value)}
                className="mt-2 w-full rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none"
                placeholder="Tell us what you do"
              />
            </>
          )}
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
          Enter your name, company, email, and industry to continue.
        </p>
      )}

      <p className="mt-8 border-t border-line pt-5 text-xs text-ink-muted leading-relaxed">
        By completing this assessment, you consent to Faulk &amp; Winkler using
        your anonymized responses for research and analysis. Your identity and
        individual information will remain confidential.
      </p>

      <p className="mt-6 text-xs text-ink-muted">
        An advisory diagnostic.
      </p>
    </div>
  );
}
