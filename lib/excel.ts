import ExcelJS from "exceljs";
import { QUESTIONS } from "./questions";
import type { Submission } from "@prisma/client";

// Builds the reviewable Excel export Ben asked for: one row per
// submission, the four gap scores and overall score up front (so it can
// be scanned like a client list), then every one of the 28 raw 1-5
// answers as its own column so nothing is hidden behind the computed
// score. This is the "so they can be reviewed" piece; Noah's next phase
// (Action Library + Combo Rules) reads from the same `answers` JSON this
// sheet is built from, so nothing here needs to change when that lands.

const BRAND_MAROON = "FF6D0104";
const HEADER_TEXT = "FFFFFFFF";

export async function buildSubmissionsWorkbook(
  submissions: Submission[]
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "F&W WAVE Scorecard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Submissions", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const baseColumns = [
    { header: "Submitted", key: "createdAt", width: 19 },
    { header: "Prospect name", key: "prospectName", width: 20 },
    { header: "Company", key: "companyName", width: 22 },
    { header: "Wealth score", key: "wealthScore", width: 13 },
    { header: "Accounting score", key: "accountingScore", width: 16 },
    { header: "Value score", key: "valueScore", width: 12 },
    { header: "Earnings score", key: "earningsScore", width: 14 },
    { header: "Overall score", key: "overallScore", width: 13 },
    { header: "Readiness band", key: "readinessBand", width: 18 },
  ];

  const questionColumns = QUESTIONS.map((q) => ({
    header: q.id,
    key: q.id,
    width: 6,
  }));

  sheet.columns = [...baseColumns, ...questionColumns];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND_MAROON },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  headerRow.height = 20;

  for (const s of submissions) {
    const answers = s.answers as Record<string, number>;
    const row: Record<string, string | number> = {
      createdAt: s.createdAt.toISOString().replace("T", " ").slice(0, 19),
      prospectName: s.prospectName ?? "",
      companyName: s.companyName ?? "",
      wealthScore: s.wealthScore,
      accountingScore: s.accountingScore,
      valueScore: s.valueScore,
      earningsScore: s.earningsScore,
      overallScore: s.overallScore,
      readinessBand: s.readinessBand,
    };
    for (const q of QUESTIONS) {
      row[q.id] = answers[q.id] ?? "";
    }
    sheet.addRow(row);
  }

  // A light banded look (every other row tinted) makes a 28-plus-column
  // sheet meaningfully easier to scan than pure white, without needing
  // anyone to apply their own formatting after downloading it.
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

  return workbook.xlsx.writeBuffer();
}
