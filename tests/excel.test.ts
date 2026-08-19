import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildSubmissionsWorkbook } from "@/lib/excel";
import type { Submission } from "@prisma/client";
import type { StoredQuestion } from "@/lib/questionSet";

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
