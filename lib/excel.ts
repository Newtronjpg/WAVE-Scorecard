import ExcelJS from "exceljs";
import type { Submission } from "@prisma/client";
import type { StoredQuestion } from "./questionSet";

// Two sheets. Submissions is the scannable list -- gap scores, overall,
// band, which question set a run answered -- with no per-question columns;
// a run's full answer-by-answer detail lives in its own export
// (lib/excelRun.ts) instead. Question sets is the reference: one row per
// question per published version, so "what did W3 mean in March" is
// answerable from this workbook alone.

const BRAND_MAROON = "FF6D0104";
const HEADER_TEXT = "FFFFFFFF";
const MAX_CHOICE_COLUMNS = 7;

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND_MAROON },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  row.height = 20;
}

function bandRows(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF7F0EF" },
        };
      });
    }
  });
}

export interface QuestionSetVersionRow {
  version: number;
  questions: unknown;
  note: string | null;
  publishedAt: Date;
}

export async function buildSubmissionsWorkbook(
  submissions: Submission[],
  versions: QuestionSetVersionRow[]
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAVE Scorecard";
  workbook.created = new Date();

  const submissionsSheet = workbook.addWorksheet("Submissions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  submissionsSheet.columns = [
    { header: "Submitted", key: "createdAt", width: 19 },
    { header: "Prospect name", key: "prospectName", width: 20 },
    { header: "Company", key: "companyName", width: 22 },
    { header: "Wealth score", key: "wealthScore", width: 13 },
    { header: "Accounting score", key: "accountingScore", width: 16 },
    { header: "Value score", key: "valueScore", width: 12 },
    { header: "Earnings score", key: "earningsScore", width: 14 },
    { header: "Overall score", key: "overallScore", width: 13 },
    { header: "Readiness band", key: "readinessBand", width: 18 },
    { header: "Email", key: "email", width: 28 },
    { header: "Industry", key: "industry", width: 24 },
    { header: "Question set", key: "questionSetVersion", width: 12 },
  ];

  styleHeaderRow(submissionsSheet.getRow(1));

  for (const s of submissions) {
    submissionsSheet.addRow({
      createdAt: s.createdAt.toISOString().replace("T", " ").slice(0, 19),
      prospectName: s.prospectName ?? "",
      companyName: s.companyName ?? "",
      wealthScore: s.wealthScore,
      accountingScore: s.accountingScore,
      valueScore: s.valueScore,
      earningsScore: s.earningsScore,
      overallScore: s.overallScore,
      email: s.email ?? "",
      industry: s.industry ?? "",
      readinessBand: s.readinessBand,
      questionSetVersion: s.questionSetVersion ?? "factory",
    });
  }

  bandRows(submissionsSheet);

  const versionsSheet = workbook.addWorksheet("Question sets", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const choiceColumns = Array.from({ length: MAX_CHOICE_COLUMNS }, (_, i) => ({
    header: `Choice ${i + 1}`,
    key: `choice${i + 1}`,
    width: 28,
  }));

  versionsSheet.columns = [
    { header: "Version", key: "version", width: 10 },
    { header: "Published", key: "publishedAt", width: 19 },
    { header: "Note", key: "note", width: 24 },
    { header: "Question ID", key: "questionId", width: 12 },
    { header: "Gap", key: "gap", width: 12 },
    { header: "Statement", key: "statement", width: 40 },
    { header: "Choices", key: "choiceCount", width: 9 },
    ...choiceColumns,
  ];

  styleHeaderRow(versionsSheet.getRow(1));

  for (const v of versions) {
    const questions = v.questions as StoredQuestion[];
    for (const q of questions) {
      const row: Record<string, string | number> = {
        version: v.version,
        publishedAt: v.publishedAt.toISOString().replace("T", " ").slice(0, 19),
        note: v.note ?? "",
        questionId: q.id,
        gap: q.gap,
        statement: q.statement,
        choiceCount: q.levels.length,
      };
      q.levels.forEach((level, i) => {
        row[`choice${i + 1}`] = `${level.label} — ${level.description}`;
      });
      versionsSheet.addRow(row);
    }
  }

  bandRows(versionsSheet);

  return workbook.xlsx.writeBuffer();
}
