import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildSubmissionsWorkbook } from "@/lib/excel";
import { buildRunWorkbook } from "@/lib/excelRun";
import type { Submission } from "@prisma/client";
import type { StoredQuestion } from "@/lib/questionSet";
import type { Question } from "@/lib/questions";
import { withDerivedTiers } from "@/lib/questionSet";

// The summary export used to carry all 28 raw answers as their own
// columns. That's gone: the point of this sheet is to be scannable, and
// nothing here needs per-question detail anymore now that a single run's
// full answers live in its own export (see tests for lib/excelRun.ts).
// This sheet instead records WHICH question set each submission answered,
// and a second sheet spells out what every published version actually
// asked, so "what did Q W3 mean in March" is always answerable from the
// workbook alone.

function fakeSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "sub-1",
    createdAt: new Date("2026-03-01T12:00:00Z"),
    prospectName: "Jane Owner",
    companyName: "Acme Fabrication",
    answers: { W1: 3 },
    wealthScore: 50,
    accountingScore: 75,
    valueScore: 50,
    earningsScore: 57,
    overallScore: 58,
    readinessBand: "Meaningful gaps",
    questionSetVersion: 3,
    questionSetSnapshot: null,
    ...overrides,
  } as Submission;
}

function fakeQuestions(count: number): StoredQuestion[] {
  return [
    {
      id: "W1",
      gap: "wealth",
      statement: "A test question.",
      levels: Array.from({ length: count }, (_, i) => ({
        value: i + 1,
        label: `Label ${i + 1}`,
        description: `Description ${i + 1}`,
      })),
    },
  ];
}

async function loadWorkbook(buffer: ExcelJS.Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

// A round-tripped (written then re-loaded) worksheet only knows column
// POSITIONS, not the original in-memory `key` config -- .xlsx itself has
// no concept of a key. Look the header up by its text instead.
function columnIndexFor(sheet: ExcelJS.Worksheet, header: string): number {
  const headers = sheet.getRow(1).values as unknown[];
  const index = headers.findIndex((h) => h === header);
  if (index === -1) throw new Error(`No column header "${header}"`);
  return index;
}

describe("buildSubmissionsWorkbook", () => {
  it("has no per-question columns on the Submissions sheet", async () => {
    const buffer = await buildSubmissionsWorkbook([fakeSubmission()], []);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Submissions")!;
    const headers = (sheet.getRow(1).values as unknown[]).filter(Boolean);
    expect(headers).not.toContain("W1");
  });

  it("carries the gap scores, overall, band, and a Question set column", async () => {
    const buffer = await buildSubmissionsWorkbook([fakeSubmission()], []);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Submissions")!;
    const headers = (sheet.getRow(1).values as unknown[]).filter(Boolean);
    for (const expected of [
      "Wealth score",
      "Accounting score",
      "Value score",
      "Earnings score",
      "Overall score",
      "Readiness band",
      "Question set",
    ]) {
      expect(headers).toContain(expected);
    }
  });

  it("shows the version number in the Question set column", async () => {
    const buffer = await buildSubmissionsWorkbook(
      [fakeSubmission({ questionSetVersion: 5 })],
      []
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Submissions")!;
    const row = sheet.getRow(2).values as unknown[];
    expect(row).toContain(5);
  });

  it('shows "factory" when questionSetVersion is null', async () => {
    const buffer = await buildSubmissionsWorkbook(
      [fakeSubmission({ questionSetVersion: null })],
      []
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Submissions")!;
    const row = sheet.getRow(2).values as unknown[];
    expect(row).toContain("factory");
  });

  it("has a Question sets sheet", async () => {
    const buffer = await buildSubmissionsWorkbook(
      [fakeSubmission()],
      [{ version: 3, questions: fakeQuestions(5), note: null, publishedAt: new Date() }]
    );
    const workbook = await loadWorkbook(buffer);
    expect(workbook.getWorksheet("Question sets")).toBeDefined();
  });

  it("has one row per question per version", async () => {
    const buffer = await buildSubmissionsWorkbook(
      [],
      [
        { version: 1, questions: fakeQuestions(5), note: null, publishedAt: new Date() },
        { version: 2, questions: fakeQuestions(5), note: null, publishedAt: new Date() },
      ]
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Question sets")!;
    // Header row + one row per question per version: 2 versions * 1
    // question each (fakeQuestions returns a single question) = 2 rows.
    expect(sheet.rowCount).toBe(3);
  });

  it("fills choice columns to each question's choice count and leaves the rest empty", async () => {
    const buffer = await buildSubmissionsWorkbook(
      [],
      [{ version: 1, questions: fakeQuestions(3), note: null, publishedAt: new Date() }]
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Question sets")!;
    const row = sheet.getRow(2);
    const choice1 = row.getCell(columnIndexFor(sheet, "Choice 1")).value;
    const choice4 = row.getCell(columnIndexFor(sheet, "Choice 4")).value;
    expect(choice1).toContain("Label 1");
    expect(choice4).toBeFalsy();
  });

  it("fills all 7 columns for a 7-choice question", async () => {
    const buffer = await buildSubmissionsWorkbook(
      [],
      [{ version: 1, questions: fakeQuestions(7), note: null, publishedAt: new Date() }]
    );
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Question sets")!;
    const row = sheet.getRow(2);
    for (let i = 1; i <= 7; i++) {
      expect(row.getCell(columnIndexFor(sheet, `Choice ${i}`)).value).toBeTruthy();
    }
  });

  it("produces a valid workbook with only headers when the version list is empty", async () => {
    const buffer = await buildSubmissionsWorkbook([fakeSubmission()], []);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet("Question sets")!;
    expect(sheet.rowCount).toBe(1);
  });
});

// buildRunWorkbook expands ONE submission against the exact question set it
// was scored against -- not today's -- so a question reworded or removed
// since must not change what this file says the client was asked.
function fakeRunQuestions(choiceCount: number): Question[] {
  return withDerivedTiers([
    {
      id: "W1",
      gap: "wealth",
      statement: "A three-choice test question.",
      levels: Array.from({ length: choiceCount }, (_, i) => ({
        value: i + 1,
        label: `Label ${i + 1}`,
        description: `Description ${i + 1}`,
      })),
    },
    {
      id: "W2",
      gap: "wealth",
      statement: "A second question with no answer on this run.",
      levels: Array.from({ length: 5 }, (_, i) => ({
        value: i + 1,
        label: `W2 label ${i + 1}`,
        description: `W2 description ${i + 1}`,
      })),
    },
  ]);
}

// Unlike buildSubmissionsWorkbook, this sheet has a metadata block ABOVE
// the question table, so the header row is not row 1 -- find it by
// scanning for the row containing "Question ID", then index every
// question row (everything below it) by that row's column positions.
function runQuestionRows(sheet: ExcelJS.Worksheet) {
  let headerRowNumber = -1;
  let headers: unknown[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    if (values.includes("Question ID")) {
      headerRowNumber = r;
      headers = values;
      break;
    }
  }
  if (headerRowNumber === -1) throw new Error('No "Question ID" header row found');
  const idIdx = headers.findIndex((h) => h === "Question ID");
  const scoreIdx = headers.findIndex((h) => h === "Score");
  const rows: unknown[][] = [];
  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    if (values[idIdx]) rows.push(values);
  }
  return { rows, idIdx, scoreIdx };
}

describe("buildRunWorkbook", () => {
  it("has one row per question with the statement, chosen number, choice label/description, and score", async () => {
    const submission = fakeSubmission({ answers: { W1: 3, W2: 1 } });
    const buffer = await buildRunWorkbook(submission, fakeRunQuestions(5), "version 3");
    const workbook = await loadWorkbook(buffer);
    const { rows, idIdx } = runQuestionRows(workbook.worksheets[0]);
    expect(rows.length).toBe(2);
    const w1Row = rows.find((r) => r[idIdx] === "W1")!;
    expect(w1Row.join("|")).toContain("A three-choice test question.");
    expect(w1Row.join("|")).toContain("Label 3");
    expect(w1Row.join("|")).toContain("Description 3");
  });

  it("the score column matches normalizeAnswer(answer, choiceCount)", async () => {
    // Rating 3 of 5 -> (3-1)/(5-1)*100 = 50.
    const submission = fakeSubmission({ answers: { W1: 3, W2: 1 } });
    const buffer = await buildRunWorkbook(submission, fakeRunQuestions(5), "version 3");
    const workbook = await loadWorkbook(buffer);
    const { rows, idIdx, scoreIdx } = runQuestionRows(workbook.worksheets[0]);
    const w1Row = rows.find((r) => r[idIdx] === "W1")!;
    expect(w1Row[scoreIdx]).toBe(50);
  });

  it("a three-choice question's top answer scores 100, not 50 -- proving it uses THIS run's question set", async () => {
    // Rating 3 of 3 -> 100. If the export used today's (5-choice)
    // definition instead, rating 3 of 5 would read 50.
    const submission = fakeSubmission({ answers: { W1: 3, W2: 1 } });
    const buffer = await buildRunWorkbook(submission, fakeRunQuestions(3), "version 3");
    const workbook = await loadWorkbook(buffer);
    const { rows, idIdx, scoreIdx } = runQuestionRows(workbook.worksheets[0]);
    const w1Row = rows.find((r) => r[idIdx] === "W1")!;
    expect(w1Row[scoreIdx]).toBe(100);
  });

  it("renders blank rather than throwing for a question the run has no answer for", async () => {
    const submission = fakeSubmission({ answers: { W1: 3 } }); // no W2
    const buffer = await buildRunWorkbook(submission, fakeRunQuestions(5), "version 3");
    const workbook = await loadWorkbook(buffer);
    const { rows, idIdx, scoreIdx } = runQuestionRows(workbook.worksheets[0]);
    const w2Row = rows.find((r) => r[idIdx] === "W2")!;
    expect(w2Row[scoreIdx]).toBeFalsy();
  });

  it("the header block carries prospect, company, overall score, band, and the version label", async () => {
    const submission = fakeSubmission({
      prospectName: "Jane Owner",
      companyName: "Acme Fabrication",
      overallScore: 58,
      readinessBand: "Meaningful gaps",
      answers: { W1: 3, W2: 1 },
    });
    const buffer = await buildRunWorkbook(submission, fakeRunQuestions(5), "version 3");
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];
    const text = JSON.stringify(sheet.getSheetValues());
    expect(text).toContain("Jane Owner");
    expect(text).toContain("Acme Fabrication");
    expect(text).toContain("58");
    expect(text).toContain("Meaningful gaps");
    expect(text).toContain("version 3");
  });
});
