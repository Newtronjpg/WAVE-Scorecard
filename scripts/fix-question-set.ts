// One-off: rewrite the entire question set from the internal workbook.
//
// Dry run (default -- no writes, prints a field-level diff):
//   DATABASE_URL='<url>' npx tsx scripts/fix-question-set.ts
//
// Apply (writes the draft row + a new published version):
//   DATABASE_URL='<url>' npx tsx scripts/fix-question-set.ts --apply
//
// Point at a different workbook with --workbook '<path>'.
//
// Statements and rating descriptions are READ FROM THE WORKBOOK, never
// transcribed by hand. A3's rubric had already drifted to content
// belonging to a different question without anyone noticing; hand-copying
// 20 questions x 4 descriptions is exactly how that happens, so the
// workbook is parsed at run time and is the only source for that text.
//
// The one thing not in the workbook is the short button label for each
// rating (it has only the long "what each rating means" text), so LABELS
// below carries those. They are UI affordances, not scoring content --
// the descriptions underneath them still come from the workbook.
//
// Safety properties:
//   - Dry run is the DEFAULT; --apply is required to write.
//   - Refuses to run unless it parses exactly 20 questions in a 4/6/5/5
//     split, and refuses if validateQuestionSet (the same gatekeeper the
//     admin UI uses) rejects the result.
//   - Refuses to APPLY if the phrase-coverage audit fails, since that
//     would ship gap paragraphs with missing opportunity sentences.
//   - Dumps the current published version AND the current draft row to a
//     timestamped JSON file before writing. QuestionSetVersion is
//     append-only so the old version survives anyway, but the draft row
//     is overwritten in place and would otherwise be unrecoverable.
//   - Writes the draft and the new version in ONE transaction.
//   - Stores no tier field: tiers are derived from value + choice count
//     (lib/questionSet.ts), so A4 going 5 -> 4 choices needs no migration.

import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { db } from "../lib/db";
import {
  validateQuestionSet,
  withDerivedTiers,
  type StoredQuestion,
  type StoredLevel,
} from "../lib/questionSet";
import type { Gap } from "../lib/questions";
import { auditPhraseCoverage } from "../lib/resultsCopy";

const DEFAULT_WORKBOOK =
  "/Users/noahnewton/Desktop/WAVE_Assessment_Internal_Workbook_v8 (1).xlsx";
const SHEET = "Assessment";
// 1-indexed (exceljs): C = id, D = statement, G = "what each rating means".
const COL_ID = 3;
const COL_STATEMENT = 4;
const COL_RUBRIC = 7;

// Short button labels, in rating order 1-4. The workbook has no column for
// these. Labels marked DERIVED were completed from the workbook's own
// description text because the original list reached me truncated -- they
// are flagged in the run output so they can be spot-checked.
const DERIVED = new Set([
  "W1:4", "W2:3", "W2:4", "W4:3", "W4:4", "A1:1", "A3:1", "A3:3", "A3:4",
  "A4:2", "A4:3", "V1:2", "V1:3", "V2:3", "V3:2", "V3:3", "E2:2", "E2:4",
  "E3:3",
]);

const LABELS: Record<string, [string, string, string, string]> = {
  W1: ["No real idea", "Rough guess or rule of thumb", "Recent informal estimate", "Credible formal valuation"],
  W2: ["No number", "Gut-feel target only", "Calculated but not updated", "Validated and stress-tested"],
  W3: ["Less than 3 years", "3 to 5 years", "5 to 7 years", "More than 7 years"],
  W4: ["No plan", "Written down", "Shared with wealth advisor", "Shared with all advisors"],
  A1: ["Late, unreliable close", "Slow or inconsistent", "Trusted, regular close", "Fast, diligence-ready close"],
  A2: ["No reliable budget", "Annual, occasional review", "Monthly variance review", "Rolling forecasts"],
  A3: ["Would need a lot of help", "Would be a scramble", "Most within a few weeks", "Three years within two weeks"],
  A4: ["No one I'd trust", "Not sure they could handle it", "Capable trusted person", "Briefed and ready"],
  A5: ["Internal only", "CPA compiled", "CPA reviewed", "CPA audited"],
  A6: ["No", "Some", "Most", "Yes"],
  V1: ["One customer over 50%", "Top customers 30 to 50%", "Top customers 10 to 30%", "No customer over 10%"],
  V2: ["Relies heavily on me", "Some things still depend on me", "Strong team, but still relied on", "Runs smoothly without me"],
  V3: ["Little written down", "Documented but inconsistent", "Documented, not measured", "Documented and measured"],
  V4: ["Almost none", "Less than 25%", "Roughly 25 to 50%", "More than half"],
  V5: ["Mostly manual", "Some automation, still manual-heavy", "Mostly connected, some manual", "Well integrated"],
  E1: ["No clear view", "General sense only", "Track profitability", "Detailed profitability data"],
  E2: ["Limited visibility", "Understand current position", "Regular forecasting", "Reliable forecast, proactive"],
  E3: ["Don't track consistently", "Track some, limited benchmarking", "Regular tracking, understand variances", "Active benchmarking, drives decisions"],
  E4: ["No real process", "Reactive only", "Regular tracking", "Disciplined process"],
  E5: ["Frequently mixed", "Mostly separate", "Clearly separated", "Fully separated"],
};

// Corrections applied to the workbook text, keyed "id:level". These exist
// because workbook v8 has grammatical errors that the LIVE data does not --
// applying it verbatim would regress copy that is currently correct in
// production. Every fix is enumerated in the run output so it is reviewable,
// and each is a pure apostrophe correction, never a change in meaning.
// The real fix belongs in the workbook; delete entries here as they land.
const TYPO_FIXES: Record<string, [string, string][]> = {
  "W4:2": [["and its written down", "and it's written down"]],
  "W4:3": [
    ["one, its written down", "one, it's written down"],
    ["and its shared", "and it's shared"],
  ],
  "W4:4": [
    ["one, its written down", "one, it's written down"],
    ["and its shared", "and it's shared"],
  ],
};

const GAP_BY_PREFIX: Record<string, Gap> = { W: "wealth", A: "accounting", V: "value", E: "earnings" };
const EXPECTED_PER_GAP: Record<Gap, number> = { wealth: 4, accounting: 6, value: 5, earnings: 5 };
const EXPECTED_COUNT = 20;

// The three defects known going in. Anything else the diff turns up is
// reported loudly -- unexpected drift is the whole reason for rewriting
// exhaustively rather than patching.
const KNOWN_BROKEN = new Set(["W2", "A3", "A4"]);

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "richText" in v) {
    return (v.richText as { text: string }[]).map((r) => r.text).join("");
  }
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  return cell.text ?? "";
}

// The rubric arrives as one cell holding four numbered lines. Splitting on
// a leading "N." is deliberately tolerant of the workbook's inconsistent
// spacing ("1. foo" vs "2.foo") and of hard line breaks inside a line.
function parseRubric(raw: string): string[] {
  const normalized = raw.replace(/\r/g, "");
  const matches = [...normalized.matchAll(/(?:^|\n)\s*([1-4])\s*\.\s*/g)];
  if (matches.length !== 4) return [];

  const out: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : normalized.length;
    out.push(normalized.slice(start, end).replace(/\s+/g, " ").trim());
  }
  return out;
}

const appliedFixes: string[] = [];

async function loadFromWorkbook(path: string): Promise<StoredQuestion[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet "${SHEET}" not found in ${path}`);

  const questions: StoredQuestion[] = [];
  const problems: string[] = [];

  ws.eachRow((row) => {
    const id = cellText(row.getCell(COL_ID)).trim();
    if (!/^[WAVE][0-9]+$/.test(id)) return; // skips titles, section banners, score summary

    const statement = cellText(row.getCell(COL_STATEMENT)).replace(/\s+/g, " ").trim();
    const rubric = parseRubric(cellText(row.getCell(COL_RUBRIC)));
    const labels = LABELS[id];

    if (!statement) problems.push(`${id}: no statement in the workbook.`);
    if (rubric.length !== 4) problems.push(`${id}: expected 4 numbered ratings, parsed ${rubric.length}.`);
    if (!labels) problems.push(`${id}: no short labels defined in LABELS.`);
    if (!statement || rubric.length !== 4 || !labels) return;

    const levels: StoredLevel[] = rubric.map((description, i) => {
      let text = description;
      for (const [find, replace] of TYPO_FIXES[`${id}:${i + 1}`] ?? []) {
        if (!text.includes(find)) {
          problems.push(`${id} level ${i + 1}: typo fix "${find}" no longer matches the workbook.`);
          continue;
        }
        text = text.replaceAll(find, replace);
        appliedFixes.push(`${id} level ${i + 1}: "${find}" -> "${replace}"`);
      }
      return { value: i + 1, label: labels[i], description: text };
    });

    questions.push({ id, gap: GAP_BY_PREFIX[id[0]], statement, levels });
  });

  if (problems.length > 0) {
    throw new Error(`Workbook parse problems:\n  - ${problems.join("\n  - ")}`);
  }
  return questions;
}

// The workbook has no column for the short button labels, so the ones in
// LABELS above were reconstructed. Production already carries labels a
// human wrote, and those are better than a reconstruction -- so keep the
// live label whenever the rating underneath it still MEANS the same thing
// (its description is unchanged bar typography). Where the description
// genuinely changed, the old label may no longer describe the rating at
// all -- A3's "Trusted but not able" against a buyer-diligence rubric --
// so the reconstruction is used there instead.
function preserveExistingLabels(
  parsed: StoredQuestion[],
  current: StoredQuestion[]
): { questions: StoredQuestion[]; kept: string[] } {
  const currentById = new Map(current.map((q) => [q.id, q]));
  const kept: string[] = [];
  const restoredPunctuation: string[] = [];

  const questions = parsed.map((question) => {
    const live = currentById.get(question.id);
    if (!live) return question;

    const levels = question.levels.map((level, i) => {
      const liveLevel = live.levels[i];
      if (!liveLevel) return level;
      // The workbook drops the closing period on a number of descriptions
      // that production punctuates correctly. Differing ONLY by trailing
      // sentence punctuation is not an edit, so keep production's.
      const bare = (t: string) => normalizeTypography(t).replace(/[.]+$/, "");
      if (
        bare(liveLevel.description) === bare(level.description) &&
        liveLevel.description !== level.description &&
        /[.]$/.test(liveLevel.description.trim()) &&
        !/[.]$/.test(level.description.trim())
      ) {
        restoredPunctuation.push(`${question.id} level ${i + 1}`);
        return { ...level, description: liveLevel.description, label: liveLevel.label || level.label };
      }

      const sameMeaning =
        normalizeTypography(liveLevel.description) === normalizeTypography(level.description);
      if (sameMeaning && liveLevel.label.trim() && liveLevel.label !== level.label) {
        kept.push(`${question.id} level ${i + 1}: kept "${liveLevel.label}" (not "${level.label}")`);
        return { ...level, label: liveLevel.label };
      }
      return level;
    });

    return { ...question, levels };
  });

  if (restoredPunctuation.length > 0) {
    console.log(
      `\n${restoredPunctuation.length} description(s) kept production's closing period ` +
        `(workbook omits it): ${restoredPunctuation.join(", ")}`
    );
  }
  return { questions, kept };
}

type Diff = { id: string; field: string; before: string; after: string; kind: "substantive" | "typography" };

// A curly apostrophe from Word against a straight one typed in the admin
// UI is not drift, but there are enough of them across 20 questions to
// bury a real content change. Classifying them separately is what makes
// "anything unexpected changed" a signal worth reading.
function normalizeTypography(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(before: string, after: string): "substantive" | "typography" {
  return normalizeTypography(before) === normalizeTypography(after) ? "typography" : "substantive";
}

// Long strings that differ late are useless truncated to the first 100
// characters, so show the neighbourhood of the first divergence instead.
function showDivergence(before: string, after: string): { before: string; after: string } {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  if (i <= 60) return { before: truncate(before), after: truncate(after) };
  const from = Math.max(0, i - 30);
  return {
    before: `...${truncate(before.slice(from), 90)}`,
    after: `...${truncate(after.slice(from), 90)}`,
  };
}

function diffQuestions(before: StoredQuestion[], after: StoredQuestion[]): Diff[] {
  const diffs: Diff[] = [];
  const beforeById = new Map(before.map((q) => [q.id, q]));
  const afterById = new Map(after.map((q) => [q.id, q]));

  for (const [id, next] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) {
      diffs.push({ id, field: "(question)", before: "(absent)", after: "ADDED", kind: "substantive" });
      continue;
    }
    if (prev.gap !== next.gap)
      diffs.push({ id, field: "gap", before: prev.gap, after: next.gap, kind: "substantive" });
    if (prev.statement !== next.statement)
      diffs.push({
        id,
        field: "statement",
        before: prev.statement,
        after: next.statement,
        kind: classify(prev.statement, next.statement),
      });
    if (prev.levels.length !== next.levels.length)
      diffs.push({
        id,
        field: "choiceCount",
        before: String(prev.levels.length),
        after: String(next.levels.length),
        kind: "substantive",
      });

    for (let i = 0; i < Math.max(prev.levels.length, next.levels.length); i++) {
      const p = prev.levels[i];
      const n = next.levels[i];
      if (!p || !n) {
        diffs.push({
          id,
          field: `level ${i + 1}`,
          before: p ? p.label : "(absent)",
          after: n ? n.label : "(REMOVED)",
          kind: "substantive",
        });
        continue;
      }
      if (p.value !== n.value)
        diffs.push({ id, field: `level ${i + 1} value`, before: String(p.value), after: String(n.value), kind: "substantive" });
      if (p.label !== n.label)
        diffs.push({ id, field: `level ${i + 1} label`, before: p.label, after: n.label, kind: classify(p.label, n.label) });
      if (p.description !== n.description)
        diffs.push({
          id,
          field: `level ${i + 1} description`,
          before: p.description,
          after: n.description,
          kind: classify(p.description, n.description),
        });
    }
  }

  for (const id of beforeById.keys()) {
    if (!afterById.has(id))
      diffs.push({ id, field: "(question)", before: "present", after: "REMOVED", kind: "substantive" });
  }
  return diffs;
}

function truncate(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workbookPath = argValue("--workbook") ?? DEFAULT_WORKBOOK;

  console.log(`Workbook: ${workbookPath}`);
  const parsed = await loadFromWorkbook(workbookPath);
  console.log(`Parsed ${parsed.length} questions from the workbook.`);
  if (appliedFixes.length > 0) {
    console.log(`\n${appliedFixes.length} typo correction(s) applied to workbook text (see TYPO_FIXES):`);
    for (const f of appliedFixes) console.log(`  ${f}`);
  }

  if (parsed.length !== EXPECTED_COUNT) {
    console.error(`REFUSING TO RUN: parsed ${parsed.length} questions, expected ${EXPECTED_COUNT}.`);
    process.exit(1);
  }
  for (const [gap, expected] of Object.entries(EXPECTED_PER_GAP) as [Gap, number][]) {
    const actual = parsed.filter((q) => q.gap === gap).length;
    if (actual !== expected) {
      console.error(`REFUSING TO RUN: ${gap} has ${actual} questions, expected ${expected}.`);
      process.exit(1);
    }
  }

  const preliminary = await db.questionSetVersion.findFirst({ orderBy: { version: "desc" } });
  const preliminaryValidation = preliminary ? validateQuestionSet(preliminary.questions) : null;
  const liveForLabels: StoredQuestion[] =
    preliminaryValidation && preliminaryValidation.ok ? preliminaryValidation.questions : [];
  const { questions: reconciled, kept } = preserveExistingLabels(parsed, liveForLabels);
  if (kept.length > 0) {
    console.log(`\n${kept.length} existing production label(s) preserved over the reconstruction:`);
    for (const k of kept) console.log(`  ${k}`);
  }

  const validation = validateQuestionSet(reconciled);
  if (!validation.ok) {
    console.error("REFUSING TO RUN: the new question set failed validation:");
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  const validated = validation.questions;
  console.log(`Validation OK (4/6/5/5 split confirmed, 4 choices each).`);

  const derivedUsed = [...DERIVED].sort();
  console.log(`\n${derivedUsed.length} short labels were completed from workbook description text (spot-check these):`);
  for (const key of derivedUsed) {
    const [id, n] = key.split(":");
    console.log(`  ${id} level ${n}: "${LABELS[id]?.[Number(n) - 1]}"`);
  }

  const latest = await db.questionSetVersion.findFirst({ orderBy: { version: "desc" } });
  if (!latest) {
    console.error("REFUSING TO RUN: no published version found; this script rewrites an existing set.");
    process.exit(1);
  }
  const draft = await db.questionDraft.findUnique({ where: { id: "draft" } });

  const currentValidation = validateQuestionSet(latest.questions);
  const current: StoredQuestion[] = currentValidation.ok ? currentValidation.questions : [];
  if (!currentValidation.ok) {
    console.log(
      `\nNOTE: live version ${latest.version} does not itself pass validation ` +
        `(${currentValidation.errors.length} problem(s)) -- diffing best-effort against what parsed.`
    );
  }

  const nextVersion = latest.version + 1;
  console.log(`\nLive version ${latest.version} (${current.length} questions) -> new version ${nextVersion}`);

  const diffs = diffQuestions(current, validated);
  const substantive = diffs.filter((d) => d.kind === "substantive");
  const typography = diffs.filter((d) => d.kind === "typography");
  const changedIds = [...new Set(substantive.map((d) => d.id))].sort();
  const unexpected = changedIds.filter((id) => !KNOWN_BROKEN.has(id));

  console.log(
    `\n--- DIFF: ${substantive.length} substantive change(s) across ${changedIds.length} question(s); ` +
      `${typography.length} typography-only change(s) suppressed ---`
  );
  for (const id of changedIds) {
    console.log(`\n${id} [${KNOWN_BROKEN.has(id) ? "known-broken" : "UNEXPECTED"}]`);
    for (const d of substantive.filter((x) => x.id === id)) {
      const shown = showDivergence(d.before, d.after);
      console.log(`  ${d.field}`);
      console.log(`    before: ${shown.before}`);
      console.log(`    after:  ${shown.after}`);
    }
  }

  if (typography.length > 0) {
    const byId = [...new Set(typography.map((d) => d.id))].sort();
    console.log(
      `\nTypography-only (curly quotes, dashes, whitespace) on: ${byId.join(", ")} -- not drift.`
    );
  }

  if (unexpected.length > 0) {
    console.log(
      `\n*** ${unexpected.length} question(s) changed SUBSTANTIVELY beyond the known-broken W2/A3/A4: ` +
        `${unexpected.join(", ")} ***\n` +
        `    These were reported as already fixed by hand. Review before applying.`
    );
  } else {
    console.log(`\nNo substantive drift beyond the expected W2/A3/A4.`);
  }

  const audit = auditPhraseCoverage(withDerivedTiers(validated));
  console.log(`\n--- PHRASE COVERAGE AUDIT (results-page regression gate) ---`);
  console.log(`ok = ${audit.ok}`);
  if (audit.questionsWithoutPhrase.length > 0)
    console.log(`  questions with no phrase: ${audit.questionsWithoutPhrase.join(", ")}`);
  for (const s of audit.phrasesWithoutQuestion) console.log(`  phrase with no question: ${truncate(s)}`);

  if (!apply) {
    console.log(`\nDRY RUN -- nothing written. Re-run with --apply to write.`);
    return;
  }

  if (!audit.ok) {
    console.error(
      `\nREFUSING TO APPLY: phrase coverage audit failed -- the results page would render gap ` +
        `paragraphs with missing opportunity sentences. Reconcile the workbook statements with ` +
        `lib/resultsCopy.ts first.`
    );
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `question-set-backup-v${latest.version}-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        publishedVersion: latest.version,
        publishedAt: latest.publishedAt,
        publishedQuestions: latest.questions,
        draftUpdatedAt: draft?.updatedAt ?? null,
        draftQuestions: draft?.questions ?? null,
      },
      null,
      2
    )
  );
  console.log(`\nBackup written: ${backupPath}`);

  const payload = validated as unknown as Prisma.InputJsonValue;
  await db.$transaction([
    db.questionDraft.upsert({
      where: { id: "draft" },
      create: { id: "draft", questions: payload },
      update: { questions: payload },
    }),
    db.questionSetVersion.create({
      data: {
        version: nextVersion,
        questions: payload,
        note: "Full rewrite from internal workbook v8: fixes W2 statement, A3 rubric, A4 choice count",
      },
    }),
  ]);

  console.log(`APPLIED: draft updated and version ${nextVersion} published (was ${latest.version}).`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
