// Results-page copy: the per-gap paragraph shown for each gap, plus the
// "single biggest opportunity" sentence naming that gap's weakest question.
//
// Every string below is VERBATIM from the approved copy document
// (wave-scorecard-copy.md). Do not paraphrase, tighten, or fix wording
// here -- if copy is wrong, it gets corrected in that document first and
// then transcribed. The one exception is the Overall band text, which
// lives in lib/scoring.ts (READINESS_BANDS) and carries its own note about
// the redundancy pass performed against the paragraphs below.
//
// Phrases are matched to live questions BY STATEMENT TEXT, not by id: ids
// in the published set are assigned by the /admin/questions tool and are
// not guaranteed to be "W1"/"A1"/etc. auditPhraseCoverage is the gate that
// proves the copy and the live set still line up -- run it whenever the
// published question set changes.

import { GAPS, type Gap, type Question } from "./questions";

export interface PhraseEntry {
  // Provisional id, kept only so QUESTION_PHRASES can be keyed by id for
  // buildGapParagraph. The statement is the authoritative join key.
  questionId: string;
  // Verbatim question statement from the copy document.
  statement: string;
  // Verbatim phrase completing "The single biggest opportunity here is
  // {phrase}." -- lowercase-initial and with no trailing period, because
  // buildGapParagraph supplies both.
  phrase: string;
}

export const PHRASE_TABLE: PhraseEntry[] = [
  {
    questionId: "W1",
    statement:
      "I know what my business is worth today, based on a credible recent valuation — not a guess or a rule of thumb.",
    phrase: "getting a real valuation on paper instead of a rule of thumb",
  },
  {
    questionId: "W2",
    statement:
      "Have you determined the specific after-tax amount you need from the sale of your business to fund your retirement — and how confident are you in that figure?",
    phrase: "working out the after-tax number you actually need to walk away with",
  },
  {
    questionId: "W3",
    statement:
      "How much runway do you have before you'd like to step back or transition out of the business?",
    phrase:
      "giving yourself more runway — or at least pinning down a working timeline",
  },
  {
    questionId: "W4",
    statement: "I have a plan for how and when I'll hand off or sell the business.",
    phrase:
      "getting your plan written down and shared with your CPA, attorney, and wealth advisor",
  },
  {
    questionId: "A1",
    statement:
      "Our accounting team produces accurate monthly financials on a timely close.",
    phrase:
      "getting your monthly financials accurate and closed on a predictable schedule",
  },
  {
    questionId: "A2",
    statement:
      "How would you rate your company's budgeting and forecasting process, including how regularly you compare actual results to budget and update forecasts as business conditions change?",
    phrase:
      "building a budget and a forward-looking forecast, not just a record of what already happened",
  },
  {
    questionId: "A3",
    statement:
      "If a buyer showed up tomorrow, do you think you could deliver meaningful information to them in a timely manner while maintaining the appropriate level of confidentiality?",
    phrase:
      "getting three clean years of financials assembled before anyone asks for them",
  },
  {
    questionId: "A4",
    statement:
      "I have someone financially capable I trust to work on a confidential deal without alarming the rest of the staff.",
    phrase:
      "having one financially capable person you trust to work on something confidential",
  },
  {
    questionId: "A5",
    statement: "What's the highest level of externally reported financial statements?",
    phrase:
      "stepping your financial statements up to a level an outside party can rely on",
  },
  {
    questionId: "A6",
    statement:
      "Does my team have the bandwidth to take on deal work on top of their regular job?",
    phrase:
      "freeing up the time your accounting team would need to carry deal work on top of their day job",
  },
  {
    questionId: "V1",
    statement: "How concentrated is your business among key customers and vendors?",
    phrase:
      "spreading your revenue across more customers and lining up backups for your critical vendors",
  },
  {
    questionId: "V2",
    statement:
      "How dependent is the business on you or other key individuals to operate successfully?",
    phrase: "building the bench so the business keeps running when you are not there",
  },
  {
    questionId: "V3",
    statement: "How well are your internal processes documented?",
    phrase:
      "getting your key processes written down instead of living in people's heads",
  },
  {
    questionId: "V4",
    statement: "What percent of your revenue is recurring?",
    phrase: "growing the share of your revenue that repeats or sits under contract",
  },
  {
    questionId: "V5",
    // Reconciled to the internal workbook's wording (the question source of
    // truth), which is longer than the copy document's shorthand. This field
    // is only a join key -- the phrase itself is unchanged.
    statement:
      "How much of your day-to-day data and reporting is automated versus manually updated across different systems?",
    phrase:
      "connecting your systems so your reporting does not depend on manual work",
  },
  {
    questionId: "E1",
    statement:
      "I know which jobs, products, or customers make me the most money — and which ones lose money.",
    phrase:
      "finding out which jobs, products, and customers actually make you money",
  },
  {
    questionId: "E2",
    statement: "How would you rate your ability to understand your cash flow?",
    phrase: "getting a forward view of your cash so it stops catching you off guard",
  },
  {
    questionId: "E3",
    statement:
      "How well do you track and benchmark your key financial and operating KPIs, including margins, against targets and industry standards?",
    phrase:
      "tracking a handful of numbers every month and knowing how your margins compare to your peers",
  },
  {
    questionId: "E4",
    statement: "How effectively do you monitor and control costs across the business?",
    phrase:
      "putting a real cost-control process in place, not just keeping an eye on things",
  },
  {
    questionId: "E5",
    statement: "How clearly are your personal and business finances separated?",
    phrase: "separating your personal and business finances cleanly",
  },
];

// Keyed by question id purely so buildGapParagraph can resolve a phrase
// from the lowestQuestionId that scoreAssessment hands back.
export const QUESTION_PHRASES: Record<string, string> = Object.fromEntries(
  PHRASE_TABLE.map((entry) => [entry.questionId, entry.phrase])
);

// Statement text is authored in a copy document and re-entered by hand in
// the admin UI, so the two can differ in ways that carry no meaning: case,
// a doubled space, a curly apostrophe pasted from Word, a clause separated
// by an em dash in one place and a comma in the other, a trailing period
// added or dropped. All of those were observed between the copy document
// and the published set, and treating any of them as significant silently
// drops the opportunity sentence from a live results page.
//
// So identity is reduced to words alone: apostrophes are deleted (so
// "what's" and "whats" agree) and every other non-alphanumeric character
// becomes a space (so "day-to-day" and "day to day" agree) before
// whitespace is collapsed. These statements are full sentences, so
// discarding punctuation cannot realistically make two of them collide --
// and tests/resultsCopy.test.ts asserts they still do not.
export function normalizeStatement(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[‘’ʼ']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PHRASE_BY_STATEMENT: Map<string, PhraseEntry> = new Map(
  PHRASE_TABLE.map((entry) => [normalizeStatement(entry.statement), entry])
);

export function phraseForStatement(statement: string): string | null {
  return PHRASE_BY_STATEMENT.get(normalizeStatement(statement))?.phrase ?? null;
}

// Builds the id -> phrase lookup the results page should actually use,
// keyed by the ids the LIVE question set carries and matched purely on
// statement text.
//
// This is the difference that matters: QUESTION_PHRASES is keyed by the
// provisional ids in PHRASE_TABLE, and those are not authoritative -- the
// /admin/questions tool assigns its own. An id that happens to collide
// (a live "V5" whose wording was since changed, against the table's "V5")
// would otherwise attach a phrase that was never verified against the
// question actually being asked. A question whose text does not match is
// deliberately left out, so buildGapParagraph degrades to the band
// paragraph alone and auditPhraseCoverage reports it, rather than the
// page quietly showing the wrong opportunity.
export function resolvePhrases(
  questions: { id: string; statement: string }[]
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const question of questions) {
    const entry = PHRASE_BY_STATEMENT.get(normalizeStatement(question.statement));
    if (entry) resolved[question.id] = entry.phrase;
  }
  return resolved;
}

export interface PhraseCoverageAudit {
  ok: boolean;
  // Ids of live questions with no phrase written for them.
  questionsWithoutPhrase: string[];
  // Verbatim statements from PHRASE_TABLE that match no live question --
  // typically copy written before the question was published.
  phrasesWithoutQuestion: string[];
}

// The stop-condition gate. Both lists must be empty before the results
// page can be trusted: an unmatched question renders a paragraph with no
// opportunity sentence, and an unmatched phrase means copy silently going
// unused.
export function auditPhraseCoverage(questions: Question[]): PhraseCoverageAudit {
  const liveStatements = new Set(
    questions.map((question) => normalizeStatement(question.statement))
  );

  const questionsWithoutPhrase = questions
    .filter((question) => !PHRASE_BY_STATEMENT.has(normalizeStatement(question.statement)))
    .map((question) => question.id);

  const phrasesWithoutQuestion = PHRASE_TABLE.filter(
    (entry) => !liveStatements.has(normalizeStatement(entry.statement))
  ).map((entry) => entry.statement);

  return {
    ok: questionsWithoutPhrase.length === 0 && phrasesWithoutQuestion.length === 0,
    questionsWithoutPhrase,
    phrasesWithoutQuestion,
  };
}

// Keyed by band LABEL rather than index so a re-slice of READINESS_BANDS
// can't silently shift a paragraph onto the wrong band.
export const GAP_BAND_PARAGRAPHS: Record<Gap, Record<string, string>> = {
  wealth: {
    Poor: "You have built something worth planning around — the next step is putting numbers to it: what the business is worth today, and what it needs to be worth for you. This is where almost every owner starts, and it is one of the quickest gaps to close once you begin.",
    Fair: "You have already started thinking about your number, which puts you ahead of many owners. The work now is closing the distance between that thinking and a reasonable range that you can build a plan and act upon.",
    Good: "You are further along than most owners. The pieces are there — what is likely missing is pulling them together into one coordinated plan between you and any stakeholders and advisors.",
    Great:
      "You know your number and you have a plan for getting there — that is rare. From here the job is protecting what you have built and keeping the plan current.",
  },
  accounting: {
    Poor: "Many business owners neglect timely accounting - as they have been running the business this way and know how to navigate \"from the hip.\" While this is common, it is not something that can be easily transferable and doesn't allow for adequate planning. Getting your books in order is the first meaningful step towards being ready to transition.",
    Fair: "Your books do what the business needs day to day, and that foundation is worth something. An interested party (buyer, investor, or lender) will want to dig deeper beyond your annual or even monthly financials. These requests can be daunting if not prepared, and time is often of the essence.",
    Good: "Your accounting and finance function is in good shape. What is left is refinement — speed, consistency, and having the right person or team available when something needs quiet support.",
    Great:
      "Your accounting and finance function would hold up well under outside scrutiny, which is a real accomplishment. Keep the discipline and momentum current.",
  },
  value: {
    Poor: "Often a value gap takes the longest to correct, so identification early and honestly is a good step. Understand which gaps may cause the greatest impact upon a transition or transaction, and identify meaningful and reasonable actions to take over the next 12-months. Repeat this annually and apply to other areas as capacity allows.",
    Fair: "There are real strengths here alongside a few dependencies a buyer would price in. With time on your side, most of them are very fixable. Determine the impact each gap has on value, and continue building one meaningful step at a time.",
    Good: "The business stands on its own reasonably well, which is more than most owners can say. Identify where you can refine and demonstrate value to the next owner. Further, can you begin to document how any changes have positively impacted the business - making it easier to tell the story to the next owner.",
    Great:
      "This is a business that does not depend on any one person, customer, or handshake. That is worth real money — make sure the story is documented so a buyer sees it too. Further, make sure the progress made does not get stale.",
  },
  earnings: {
    // Verbatim from the workbook's Client Copy Bank (row 32, Earnings
    // column). An earlier transcription of this paragraph read "underneath
    // what instinct is where", which is ungrammatical -- that was a
    // transcription error, not a defect in the source.
    Poor: "You have run this business on instinct and it may have worked for you up to this point. Putting numbers underneath that instinct is where the next few points of margin come from, and it can be one of the fastest areas to improve. Visibility and awareness is a great start.",
    Fair: "You have a good feel for what is working in this business, and that feel is usually right. Putting real data behind it can provide the momentum to take action, and this area can be one of the quickest to improve.",
    Good: "You track the right things, and that discipline is already paying off. The opportunity now is turning good reporting into steady margin improvement. Can you now identify the business actions and processes that are driving these results?",
    Great:
      "You know your numbers and how you compare to your peers. Keep it up: margin discipline shows up directly in what the business is worth. If you haven't already, begin to document business actions and processes that are driving these results.",
  },
};

// The full paragraph rendered for one gap: that gap's band paragraph,
// then a closing sentence naming its weakest question.
//
// Which closing sentence depends on the weakest question's RAW rating,
// not on the gap's band -- they are separate axes, and the workbook
// (Client Summary D10:D13) switches on the raw one:
//
//   rating 1-2  ->  "The single biggest opportunity here is ..."
//   rating 3    ->  "The area with the most room left is ..."
//   rating 4    ->  no closing sentence at all
//
// The rating-4 case matters: a gap where every answer is the top choice
// has no opportunity to name, and claiming one reads as broken to an
// owner who just scored full marks.
//
// A missing phrase also drops the sentence rather than rendering
// "...opportunity here is undefined."
export function buildGapParagraph(
  gap: Gap,
  band: string,
  lowestQuestionId: string,
  lowestRating: number,
  phrases: Record<string, string> = QUESTION_PHRASES
): string {
  const paragraph = GAP_BAND_PARAGRAPHS[gap]?.[band] ?? "";
  const phrase = phrases[lowestQuestionId];

  let closing = "";
  if (phrase) {
    if (lowestRating <= 2) {
      closing = `The single biggest opportunity here is ${phrase}.`;
    } else if (lowestRating === 3) {
      closing = `The area with the most room left is ${phrase}.`;
    }
    // rating 4 (or higher, on a longer scale): deliberately no sentence.
  }

  return [paragraph, closing].filter(Boolean).join(" ");
}

// Re-exported for callers that want to iterate gaps in display order
// without importing lib/questions directly.
export const GAP_ORDER: Gap[] = GAPS.map((gap) => gap.id);
