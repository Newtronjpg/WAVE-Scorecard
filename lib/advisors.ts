// The optional advisor-ranking section, asked between the Earnings Gap
// questions and the results page.
//
// Brandon's framing: someone must be able to see their results without
// answering any of this. It is intelligence about who already has the
// relationship, not part of the assessment -- nothing here feeds the score,
// and skipping it costs nothing.
//
// Dependency-free so the wording is shared by the client component, the API
// route, the admin table and both exports rather than drifting across four
// copies of the same list.

export const ADVISOR_AREAS = [
  { id: "accounting", label: "Accounting" },
  { id: "legal", label: "Legal" },
  { id: "banking", label: "Banking" },
  { id: "insurance", label: "Insurance" },
  { id: "wealth", label: "Wealth Management" },
  { id: "hr", label: "HR" },
] as const;

export type AdvisorArea = (typeof ADVISOR_AREAS)[number]["id"];

export const ADVISOR_AREA_IDS: AdvisorArea[] = ADVISOR_AREAS.map((a) => a.id);

// Deliberately the same four words the gauge and the gap readouts use. The
// respondent has just spent ten minutes reading Poor / Fair / Good / Great as
// a scale; introducing a second vocabulary here would make them learn one
// scale twice.
export const ADVISOR_RATINGS = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Good" },
  { value: 4, label: "Great" },
] as const;

export const ADVISOR_SECTION_TITLE = "Your other advisors";
export const ADVISOR_SECTION_TAGLINE =
  "Optional — skip any or all of it and your results are unaffected.";
export const ADVISOR_SECTION_INTRO =
  "If you work with advisers in any of these areas, how well is that relationship serving you today? You can name them if you'd like us to know who they are.";
export const ADVISOR_NAME_PLACEHOLDER = "Firm or adviser name (optional)";

// The maximum length of a named adviser. Long enough for "Smith, Jones &
// Partners LLP", short enough that the column and the export stay readable.
export const MAX_ADVISOR_NAME_LENGTH = 120;

export interface AdvisorEntry {
  /** 1-4, or absent when they did not rate this area. */
  rating?: number;
  /** Who the adviser is, or absent. */
  name?: string;
}

export type AdvisorRatings = Partial<Record<AdvisorArea, AdvisorEntry>>;

/**
 * Trims, bounds and drops empties, returning null when nothing survives.
 *
 * Null rather than {} for the same reason `comments` is: "answered nothing"
 * should have one representation, not two. An area with neither a rating nor
 * a name is removed entirely rather than stored as an empty object.
 */
export function normalizeAdvisorRatings(
  input: unknown
): AdvisorRatings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const source = input as Record<string, unknown>;
  const cleaned: AdvisorRatings = {};

  for (const area of ADVISOR_AREA_IDS) {
    const raw = source[area];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const entry = raw as { rating?: unknown; name?: unknown };
    const out: AdvisorEntry = {};

    if (
      typeof entry.rating === "number" &&
      Number.isInteger(entry.rating) &&
      entry.rating >= 1 &&
      entry.rating <= ADVISOR_RATINGS.length
    ) {
      out.rating = entry.rating;
    }

    if (typeof entry.name === "string") {
      const name = entry.name.trim().slice(0, MAX_ADVISOR_NAME_LENGTH);
      if (name) out.name = name;
    }

    if (out.rating !== undefined || out.name !== undefined) {
      cleaned[area] = out;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function advisorRatingLabel(rating: number | undefined): string {
  return ADVISOR_RATINGS.find((r) => r.value === rating)?.label ?? "";
}

/** One-line summary for the admin table and the exports, e.g. "Legal: Good (Smith LLP)". */
export function formatAdvisorEntry(area: AdvisorArea, entry: AdvisorEntry): string {
  const label = ADVISOR_AREAS.find((a) => a.id === area)?.label ?? area;
  const rating = advisorRatingLabel(entry.rating);
  const parts = [rating, entry.name ? `(${entry.name})` : ""].filter(Boolean);
  return `${label}: ${parts.join(" ") || "named only"}`;
}

/** How many areas they actually said something about. */
export function advisorCount(value: unknown): number {
  const cleaned = normalizeAdvisorRatings(value);
  return cleaned ? Object.keys(cleaned).length : 0;
}
