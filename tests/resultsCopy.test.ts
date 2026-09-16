import { describe, it, expect } from "vitest";
import {
  GAP_BAND_WORK,
  PHRASE_TABLE,
  QUESTION_PHRASES,
  GAP_BAND_PARAGRAPHS,
  normalizeStatement,
  phraseForStatement,
  auditPhraseCoverage,
  buildGapParagraph,
  resolvePhrases,
} from "@/lib/resultsCopy";
import { GAPS, type Question } from "@/lib/questions";
import { READINESS_BANDS } from "@/lib/scoring";

function q(id: string, gap: Question["gap"], statement: string): Question {
  return {
    id,
    gap,
    statement,
    levels: Array.from({ length: 5 }, (_, i) => ({
      value: i + 1,
      tier: "Poor" as const,
      label: `label ${i + 1}`,
      description: `description ${i + 1}`,
    })),
  };
}

describe("phrase table integrity", () => {
  it("carries one phrase for each of the 20 live questions", () => {
    expect(PHRASE_TABLE).toHaveLength(20);
  });

  it("has no duplicate question ids", () => {
    const ids = PHRASE_TABLE.map((e) => e.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate statements once normalized", () => {
    // Two rows normalizing to the same text would make text matching
    // ambiguous and silently pick whichever came first.
    const keys = PHRASE_TABLE.map((e) => normalizeStatement(e.statement));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has a non-empty phrase for every entry", () => {
    for (const entry of PHRASE_TABLE) {
      expect(entry.phrase.trim().length).toBeGreaterThan(0);
    }
  });

  it("starts every phrase lowercase so it reads on from \"...opportunity here is\"", () => {
    for (const entry of PHRASE_TABLE) {
      const first = entry.phrase[0];
      expect(first).toBe(first.toLowerCase());
    }
  });

  it("ends no phrase with a period, since buildGapParagraph adds one", () => {
    for (const entry of PHRASE_TABLE) {
      expect(entry.phrase.endsWith(".")).toBe(false);
    }
  });

  it("exposes QUESTION_PHRASES keyed by question id", () => {
    expect(Object.keys(QUESTION_PHRASES)).toHaveLength(20);
    for (const entry of PHRASE_TABLE) {
      expect(QUESTION_PHRASES[entry.questionId]).toBe(entry.phrase);
    }
  });
});

describe("normalizeStatement", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(normalizeStatement("  How Well Are Your Processes Documented?  ")).toBe(
      normalizeStatement("how well are your processes documented?")
    );
  });

  it("collapses runs of internal whitespace", () => {
    // The admin UI is a textarea; a double space is an easy human typo and
    // must not break the match.
    expect(normalizeStatement("a credible   recent valuation")).toBe(
      normalizeStatement("a credible recent valuation")
    );
  });

  it("treats curly and straight apostrophes as the same character", () => {
    expect(normalizeStatement("What’s the highest level?")).toBe(
      normalizeStatement("What's the highest level?")
    );
  });

  it("treats an em dash and a hyphen as the same separator", () => {
    expect(normalizeStatement("a guess — or a rule of thumb")).toBe(
      normalizeStatement("a guess - or a rule of thumb")
    );
  });

  it("ignores a trailing period difference", () => {
    expect(normalizeStatement("I have a plan.")).toBe(
      normalizeStatement("I have a plan")
    );
  });

  it("treats an em dash and a comma as the same clause separator", () => {
    // The copy document styles these clauses with em dashes; the same
    // sentences were entered in the admin UI with commas. Punctuation
    // style carries no meaning for identity here, and treating it as
    // significant silently drops the opportunity sentence from a live
    // results page.
    expect(
      normalizeStatement(
        "I know what my business is worth today, based on a credible recent valuation — not a guess or a rule of thumb."
      )
    ).toBe(
      normalizeStatement(
        "I know what my business is worth today, based on a credible recent valuation, not a guess or a rule of thumb."
      )
    );
  });

  it("still distinguishes two genuinely different statements", () => {
    // Guard against normalizing so aggressively that unrelated questions
    // collide and one silently borrows the other's phrase.
    expect(normalizeStatement("How well are your internal processes documented?")).not.toBe(
      normalizeStatement("What percent of your revenue is recurring?")
    );
  });
});

describe("phraseForStatement", () => {
  it("finds a phrase by exact copy-doc statement text", () => {
    expect(phraseForStatement("How well are your internal processes documented?")).toBe(
      "getting your key processes written down instead of living in people's heads"
    );
  });

  it("finds a phrase despite curly quotes and case drift from the admin UI", () => {
    expect(
      phraseForStatement("WHAT’S THE HIGHEST LEVEL OF EXTERNALLY REPORTED FINANCIAL STATEMENTS?")
    ).toBe("stepping your financial statements up to a level an outside party can rely on");
  });

  it("returns null for a statement it has never seen", () => {
    expect(phraseForStatement("Do you enjoy running this business?")).toBeNull();
  });

  it("matches a statement whose clause separator is a comma instead of an em dash", () => {
    expect(
      phraseForStatement(
        "I know which jobs, products, or customers make me the most money, and which ones lose money."
      )
    ).toBe("finding out which jobs, products, and customers actually make you money");
  });
});

describe("auditPhraseCoverage", () => {
  it("reports a clean bill when every live question matches a phrase", () => {
    const questions = PHRASE_TABLE.map((e, i) =>
      q(`LIVE${i}`, GAPS[i % GAPS.length].id, e.statement)
    );
    const audit = auditPhraseCoverage(questions);
    expect(audit.ok).toBe(true);
    expect(audit.questionsWithoutPhrase).toEqual([]);
    expect(audit.phrasesWithoutQuestion).toEqual([]);
  });

  it("names a live question that has no phrase", () => {
    const questions = [q("X9", "wealth", "A brand new question nobody wrote copy for")];
    const audit = auditPhraseCoverage(questions);
    expect(audit.ok).toBe(false);
    expect(audit.questionsWithoutPhrase).toContain("X9");
  });

  it("names a phrase that no live question matches", () => {
    // This is the A6 case: copy written before the question is published.
    const questions = PHRASE_TABLE.slice(0, 19).map((e, i) =>
      q(`LIVE${i}`, "wealth", e.statement)
    );
    const audit = auditPhraseCoverage(questions);
    expect(audit.ok).toBe(false);
    expect(audit.phrasesWithoutQuestion).toContain(PHRASE_TABLE[19].statement);
  });

  it("matches by statement text, not by id, so admin-assigned ids are irrelevant", () => {
    const questions = PHRASE_TABLE.map((e) =>
      q(`totally-unexpected-${Math.random()}`, "wealth", e.statement)
    );
    expect(auditPhraseCoverage(questions).ok).toBe(true);
  });
});

describe("GAP_BAND_PARAGRAPHS", () => {
  it("covers all four gaps", () => {
    for (const gap of GAPS) {
      expect(GAP_BAND_PARAGRAPHS[gap.id]).toBeDefined();
    }
  });

  it("covers all four band labels for every gap", () => {
    for (const gap of GAPS) {
      for (const band of READINESS_BANDS) {
        const paragraph = GAP_BAND_PARAGRAPHS[gap.id][band.label];
        expect(paragraph, `${gap.id}/${band.label}`).toBeTruthy();
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("has 16 distinct paragraphs with no copy-paste duplication", () => {
    const all = GAPS.flatMap((gap) =>
      READINESS_BANDS.map((band) => GAP_BAND_PARAGRAPHS[gap.id][band.label])
    );
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
  });

  // Widened from "ends with a period" when Ben's v9 copy deliberately closed
  // the earnings/Good paragraph on a question to the owner ("Can you now
  // identify the business actions and processes that are driving these
  // results?"). The point of the assertion is that no paragraph was truncated
  // mid-sentence, which a question mark satisfies just as well.
  it("ends every paragraph on a sentence-ending mark", () => {
    for (const gap of GAPS) {
      for (const band of READINESS_BANDS) {
        const paragraph = GAP_BAND_PARAGRAPHS[gap.id][band.label];
        expect(paragraph, `${gap.id}/${band.label}`).toMatch(/[.?!]$/);
      }
    }
  });
});

// The workbook (Client Summary D10:D13) picks the closing sentence from the
// LOWEST RAW RATING in the gap, on a separate axis from the band paragraph:
// 1-2 "the single biggest opportunity", 3 "the area with the most room
// left", 4 no sentence at all. A gap where every answer is a 4 gets the
// band paragraph alone -- telling an owner their biggest opportunity is
// something they already scored top marks on reads as broken.
describe("buildGapParagraph closing sentence by lowest rating", () => {
  const phraseV3 = "getting your key processes written down instead of living in people's heads";

  it("uses \"single biggest opportunity\" when the lowest rating is 1", () => {
    const built = buildGapParagraph("value", "Good", "V3", 1);
    expect(built).toBe(
      `${GAP_BAND_PARAGRAPHS.value.Good} The single biggest opportunity here is ${phraseV3}.`
    );
  });

  it("uses \"single biggest opportunity\" when the lowest rating is 2", () => {
    const built = buildGapParagraph("value", "Good", "V3", 2);
    expect(built).toContain("The single biggest opportunity here is");
    expect(built).not.toContain("the most room left");
  });

  it("uses \"the area with the most room left\" when the lowest rating is 3", () => {
    const built = buildGapParagraph("value", "Good", "V3", 3);
    expect(built).toBe(
      `${GAP_BAND_PARAGRAPHS.value.Good} The area with the most room left is ${phraseV3}.`
    );
    expect(built).not.toContain("single biggest opportunity");
  });

  it("adds no closing sentence at all when the lowest rating is 4", () => {
    const built = buildGapParagraph("value", "Great", "V3", 4);
    expect(built).toBe(GAP_BAND_PARAGRAPHS.value.Great);
    expect(built).not.toContain("opportunity");
    expect(built).not.toContain("room left");
  });
});

describe("buildGapParagraph", () => {
  it("joins the band paragraph and the opportunity sentence with one space", () => {
    const built = buildGapParagraph("value", "Good", PHRASE_TABLE[12].questionId, 1);
    expect(built).toBe(
      GAP_BAND_PARAGRAPHS.value.Good +
        " The single biggest opportunity here is getting your key processes written down instead of living in people's heads."
    );
  });

  it("produces exactly two sentence endings, with no double space or double period", () => {
    const built = buildGapParagraph("wealth", "Poor", PHRASE_TABLE[0].questionId, 1);
    expect(built).not.toContain("  ");
    expect(built).not.toContain("..");
    expect(built.endsWith(".")).toBe(true);
  });

  it("uses the phrase belonging to the named lowest question", () => {
    const built = buildGapParagraph("earnings", "Fair", PHRASE_TABLE[19].questionId, 1);
    expect(built).toContain(PHRASE_TABLE[19].phrase);
  });

  it("renders a band paragraph for every gap and band combination", () => {
    for (const gap of GAPS) {
      for (const band of READINESS_BANDS) {
        const built = buildGapParagraph(gap.id, band.label, PHRASE_TABLE[0].questionId, 1);
        expect(built).toContain(GAP_BAND_PARAGRAPHS[gap.id][band.label]);
        expect(built).toContain("The single biggest opportunity here is");
      }
    }
  });

  it("falls back to the band paragraph alone when the question has no phrase", () => {
    // Better a slightly shorter paragraph than a live page reading
    // "...opportunity here is undefined."
    const built = buildGapParagraph("wealth", "Great", "NOT_A_REAL_ID", 1);
    expect(built).toBe(GAP_BAND_PARAGRAPHS.wealth.Great);
    expect(built).not.toContain("undefined");
    expect(built).not.toContain("The single biggest opportunity");
  });

  it("falls back to the band paragraph alone for an unknown band label", () => {
    const built = buildGapParagraph("wealth", "Mediocre", PHRASE_TABLE[0].questionId, 1);
    expect(built).not.toContain("undefined");
    expect(built.length).toBeGreaterThan(0);
  });

  it("accepts a resolved phrase lookup so live ids need not match the table's", () => {
    const phrases = { "some-admin-uuid": "doing the thing" };
    const built = buildGapParagraph("wealth", "Poor", "some-admin-uuid", 1, phrases);
    expect(built).toContain("The single biggest opportunity here is doing the thing.");
  });
});

describe("resolvePhrases", () => {
  it("keys phrases by whatever id the admin tool assigned", () => {
    const questions = [
      q("q-abc-123", "value", "How well are your internal processes documented?"),
    ];
    expect(resolvePhrases(questions)).toEqual({
      "q-abc-123": "getting your key processes written down instead of living in people's heads",
    });
  });

  it("omits a question whose statement matches no phrase, even when its id collides with a table id", () => {
    // The real trap: the live set uses id "V5" for a question whose
    // wording was changed, while the copy table also has a "V5". Keying
    // off the id would attach a phrase nobody verified against this
    // question's actual text.
    const questions = [
      q("V5", "value", "How much of your reporting happens in a single system of record?"),
    ];
    expect(resolvePhrases(questions)).toEqual({});
  });

  it("still matches when only punctuation style differs", () => {
    const questions = [
      q("anything", "wealth", "I know what my business is worth today, based on a credible recent valuation, not a guess or a rule of thumb."),
    ];
    expect(resolvePhrases(questions).anything).toBe(
      "getting a real valuation on paper instead of a rule of thumb"
    );
  });

  it("resolves the whole table when every statement matches", () => {
    const questions = PHRASE_TABLE.map((e, i) => q(`live-${i}`, "wealth", e.statement));
    expect(Object.keys(resolvePhrases(questions))).toHaveLength(20);
  });
});

describe("GAP_BAND_WORK", () => {
  // Written to pass while the block is empty AND to validate Brandon's copy
  // the moment it lands, so adding the text needs no edit here. Every rule
  // below applies to whatever is present and skips whatever is not.
  const filled = () =>
    GAPS.flatMap((gap) =>
      READINESS_BANDS.map((band) => ({
        key: `${gap.id}/${band.label}`,
        text: GAP_BAND_WORK[gap.id][band.label],
        paragraph: GAP_BAND_PARAGRAPHS[gap.id][band.label],
      }))
    ).filter((entry) => entry.text.length > 0);

  it("keeps a slot for every gap at every band", () => {
    // The shape is the part that must not drift while the copy is pending:
    // it is what guarantees the new text can only be dropped into a real
    // gap/band pair rather than a key nothing reads.
    for (const gap of GAPS) {
      for (const band of READINESS_BANDS) {
        expect(
          GAP_BAND_WORK[gap.id]?.[band.label],
          `${gap.id}/${band.label}`
        ).toBeTypeOf("string");
      }
    }
  });

  it("is either fully written or fully empty, never half", () => {
    // A half-filled table means some results show the block and some do not,
    // for no reason the reader can see. Either state is fine; the mixture is
    // the bug.
    const count = filled().length;
    expect([0, GAPS.length * READINESS_BANDS.length]).toContain(count);
  });

  it("stores every line trimmed and ended on a sentence mark", () => {
    for (const { key, text } of filled()) {
      expect(text.trim(), key).toBe(text);
      expect(text, key).toMatch(/[.?!]$/);
    }
  });

  it("never repeats the gap paragraph it sits under", () => {
    // This is meant to evidence what F&W has done, so it must not be the same
    // sentence as the diagnosis directly above it on the page.
    for (const { key, text, paragraph } of filled()) {
      expect(text, key).not.toBe(paragraph);
    }
  });

  it("carries no spelling fixes the transcription script should have caught", () => {
    for (const { key, text } of filled()) {
      expect(text, key).not.toMatch(/buisness|efficent/);
    }
  });
});
