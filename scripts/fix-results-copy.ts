// Rewrites the results-page band paragraphs from the internal workbook.
//
// Dry run (default -- no writes, prints a cell-level diff):
//   npx tsx scripts/fix-results-copy.ts --workbook '<path>.xlsx'
//
// Apply:
//   ... same, plus --apply
//
// The "Client Copy Bank" tab says so itself: "Everything on the Client Summary
// tab is assembled from this page. Edit the wording here and the summary
// updates." So the workbook is the source for this copy and nothing here is
// transcribed by hand -- the same discipline as scripts/fix-question-set.ts,
// and for the same reason: hand-copying 20 paragraphs is how A3's rubric
// quietly became A4's content.
//
// Layout of the block this reads, which is fixed by the workbook:
//
//   row 31   header
//   rows 32-35   score bands, Poor / Fair / Good / Great
//   col B..E     the four gaps, in workbook order: wealth, accounting, value, earnings
//   col F        the Overall paragraph, which lives in READINESS_BANDS instead
//
// Two files are written, because the copy is split by where it renders:
//   lib/resultsCopy.ts   GAP_BAND_PARAGRAPHS   (columns B-E)
//   lib/scoring.ts       READINESS_BANDS[].description   (column F)

import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const SHEET = "Client Copy Bank";
const FIRST_ROW = 32;
const BANDS = ["Poor", "Fair", "Good", "Great"] as const;
const GAP_COLUMNS: { column: string; gap: string }[] = [
  { column: "B", gap: "wealth" },
  { column: "C", gap: "accounting" },
  { column: "D", gap: "value" },
  { column: "E", gap: "earnings" },
];
const OVERALL_COLUMN = "F";

// Enumerated, never a blanket spellcheck. Each entry is a plain misspelling
// with one obvious correction and no effect on meaning. Anything that changes
// what a sentence SAYS is not a typo fix -- it goes back to Ben and the
// workbook gets corrected there. The script reports those separately.
const TYPO_FIXES: [RegExp, string][] = [
  [/\bbuisness\b/g, "business"],
  [/\befficent\b/g, "efficient"],
];

// Sentences the script will not ship. These read as though an edit was left
// half-finished, and the correction is a guess about intent -- exactly what this
// script exists to avoid. A paragraph matching one of these is HELD BACK: the
// code keeps its current wording, everything else still applies, and the run
// reports what was skipped. Blocking all twenty over one sentence would just
// mean nineteen approved edits sit unshipped waiting on an email.
const SUSPECT = [
  "quickest gaps measure once you begin",
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function cellText(sheet: ExcelJS.Worksheet, ref: string): string {
  const value = sheet.getCell(ref).value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) {
    return (value.richText as { text: string }[]).map((r) => r.text).join("");
  }
  return String(value).trim();
}

function applyTypoFixes(text: string): { text: string; applied: string[] } {
  const applied: string[] = [];
  let out = text;
  for (const [pattern, replacement] of TYPO_FIXES) {
    if (pattern.test(out)) {
      applied.push(`${pattern.source} -> ${replacement}`);
      out = out.replace(pattern, replacement);
    }
    pattern.lastIndex = 0;
  }
  return { text: out, applied };
}

// Replaces one double-quoted TypeScript string literal inside a NESTED block.
//
// The scoping matters more than it looks. An earlier version searched from the
// top of GAP_BAND_PARAGRAPHS for the band key, which always matched the first
// gap's entry -- so all four gaps' paragraphs were written into `wealth`, each
// overwriting the last. It typechecked and looked plausible. The repo's own
// "every paragraph ends with a sentence-ending mark" assertion is what caught
// it, because the earnings paragraph that landed in wealth ends in a question
// mark.
//
// `outer` is the top-level declaration, `inner` the key whose sub-object or
// element to stay inside, `key` the field to replace. Throws rather than
// writing a file it could not place confidently.
function replaceNested(
  source: string,
  outer: string,
  inner: string,
  key: string,
  value: string
): string {
  const outerStart = source.indexOf(outer);
  if (outerStart === -1) throw new Error(`Could not find ${outer}`);

  const innerStart = source.indexOf(inner, outerStart);
  if (innerStart === -1) throw new Error(`Could not find ${inner} inside ${outer}`);

  const pattern = new RegExp(`(\\b${key}:\\s*\\n?\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  const slice = source.slice(innerStart);
  const match = pattern.exec(slice);
  if (!match) throw new Error(`Could not find ${key} after ${inner}`);

  // The match has to land before the next sibling begins, or it has escaped
  // the block it was scoped to.
  const nextSibling = slice.indexOf("\n  },");
  if (nextSibling !== -1 && match.index > nextSibling) {
    throw new Error(`${key} not found within the ${inner} block`);
  }

  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return source.slice(0, innerStart) + slice.replace(pattern, `$1"${escaped}"`);
}

async function main() {
  const workbookPath = arg("--workbook") ?? process.env.WAVE_WORKBOOK;
  if (!workbookPath) {
    console.error("Pass --workbook '<path>.xlsx' or set WAVE_WORKBOOK.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  const sheet = wb.getWorksheet(SHEET);
  if (!sheet) throw new Error(`No "${SHEET}" sheet in ${workbookPath}`);

  let resultsCopy = readFileSync("lib/resultsCopy.ts", "utf8");
  let scoring = readFileSync("lib/scoring.ts", "utf8");

  const changes: string[] = [];
  const typos: string[] = [];
  const suspects: string[] = [];

  BANDS.forEach((band, index) => {
    const row = FIRST_ROW + index;

    for (const { column, gap } of GAP_COLUMNS) {
      const raw = cellText(sheet, `${column}${row}`);
      if (!raw) throw new Error(`${SHEET}!${column}${row} is empty`);
      const { text, applied } = applyTypoFixes(raw);
      const flagged = SUSPECT.filter((s) => text.includes(s));
      if (flagged.length) {
        flagged.forEach((s) => suspects.push(`${gap}/${band}: "${s}"`));
        continue;
      }
      applied.forEach((a) => typos.push(`${gap}/${band}: ${a}`));
      if (!resultsCopy.includes(text)) changes.push(`${gap}/${band}`);
      resultsCopy = replaceNested(
        resultsCopy,
        "GAP_BAND_PARAGRAPHS",
        `${gap}: {`,
        band,
        text
      );
    }

    const overallRaw = cellText(sheet, `${OVERALL_COLUMN}${row}`);
    if (!overallRaw) throw new Error(`${SHEET}!${OVERALL_COLUMN}${row} is empty`);
    const { text: overall, applied } = applyTypoFixes(overallRaw);
    const overallFlagged = SUSPECT.filter((s) => overall.includes(s));
    if (overallFlagged.length) {
      overallFlagged.forEach((s) => suspects.push(`overall/${band}: "${s}"`));
      return;
    }
    applied.forEach((a) => typos.push(`overall/${band}: ${a}`));
    if (!scoring.includes(overall)) changes.push(`overall/${band}`);
    scoring = replaceNested(
      scoring,
      "READINESS_BANDS",
      `label: "${band}"`,
      "description",
      overall
    );
  });

  console.log(`${changes.length} of 20 paragraphs differ from what is in the code:`);
  for (const c of changes) console.log(`  ${c}`);
  if (typos.length) {
    console.log(`\nSpelling fixes applied (${typos.length}):`);
    for (const t of typos) console.log(`  ${t}`);
  }
  if (suspects.length) {
    console.log(`\nHELD BACK -- these look half-edited (${suspects.length}):`);
    for (const s of suspects) console.log(`  ${s}`);
    console.log("  Left at the current wording. Ben needs to confirm what he meant.");
  }

  if (!apply) {
    console.log("\nDry run. Nothing written. Pass --apply to write.");
    return;
  }
  writeFileSync("lib/resultsCopy.ts", resultsCopy);
  writeFileSync("lib/scoring.ts", scoring);
  console.log("\nWrote lib/resultsCopy.ts and lib/scoring.ts.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
