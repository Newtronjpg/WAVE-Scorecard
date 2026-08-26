// Respondent contact details collected on the landing page.
//
// Deliberately dependency-free -- no Prisma, no nodemailer, no React. The
// email check has to run in three places (the browser, /api/submit, and
// the admin settings validator), and the two existing homes for it can't
// be imported by a client component: lib/settings.ts pulls in the
// database, and lib/email.ts pulls in nodemailer. Importing either from
// IntroView would drag that into the browser bundle.

export const MAX_EMAIL_LENGTH = 200;
export const MAX_INDUSTRY_LENGTH = 100;

// The picklist exists so scores can actually be grouped by industry --
// free text turns "Manufacturing", "manufacturing", and "mfg" into three
// incomparable values, which would make the research the landing-page
// disclaimer describes impossible without hand-cleaning every row.
export const INDUSTRY_OPTIONS = [
  "Manufacturing",
  "Construction",
  "Professional services",
  "Healthcare",
  "Wholesale / distribution",
  "Retail",
  "Transportation / logistics",
  "Real estate",
  "Technology",
  "Hospitality / food service",
  "Agriculture",
  "Other",
] as const;

export const INDUSTRY_OTHER = "Other";

// Deliberately conservative: no spaces, exactly one @, a dot-bearing
// domain. This validates an address typed into a form by hand, where the
// realistic failure is a typo, not an exotic-but-legal RFC 5322 address.
//
// Plain string checks rather than one regex: a pattern like
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ lets the two [^\s@]+ groups and the
// literal "." re-split the same input many ways when the match fails,
// which is polynomial-time backtracking on adversarial input.
export function isPlausibleEmail(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

// Resolves the two-part industry control (a select, plus a free-text box
// that only appears for "Other") down to the single string that gets
// stored. Returns "" when the pair is incomplete, which is what the
// caller treats as "not answered yet".
export function resolveIndustry(selected: string, otherText: string): string {
  const choice = selected.trim();
  if (choice.length === 0) return "";
  if (choice !== INDUSTRY_OTHER) {
    // Guard against a hand-crafted request naming a category that isn't
    // on the list -- otherwise the picklist's whole point, comparable
    // values, is only enforced by the browser.
    return (INDUSTRY_OPTIONS as readonly string[]).includes(choice) ? choice : "";
  }
  const free = otherText.trim().slice(0, MAX_INDUSTRY_LENGTH);
  // "Other" on its own says nothing, so it only counts once described.
  return free.length > 0 ? `${INDUSTRY_OTHER}: ${free}` : "";
}

// True for anything resolveIndustry could legitimately have produced.
// Server-side counterpart to the browser's dropdown.
export function isValidIndustry(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INDUSTRY_LENGTH + INDUSTRY_OTHER.length + 2) {
    return false;
  }
  if ((INDUSTRY_OPTIONS as readonly string[]).includes(trimmed)) {
    return trimmed !== INDUSTRY_OTHER;
  }
  return trimmed.startsWith(`${INDUSTRY_OTHER}: `) &&
    trimmed.length > `${INDUSTRY_OTHER}: `.length;
}
