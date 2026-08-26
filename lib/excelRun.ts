import ExcelJS from "exceljs";
import type { Submission } from "@prisma/client";
import type { Question } from "./questions";
import { normalizeAnswer } from "./scoring";
import { commentsMap } from "./comments";
import { followUpLabel } from "./followUp";

// One run, fully expanded, against the question set that run actually
// answered -- not today's. A question reworded or removed since must not
// change what this file says the client was asked.

const BRAND_MAROON = "FF6D0104";
const HEADER_TEXT = "FFFFFFFF";

export async function buildRunWorkbook(
  submission: Submission,
  questions: Question[],
  versionLabel: string
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAVE Scorecard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Run");
  const answers = submission.answers as Record<string, number>;
  const comments = commentsMap(submission.comments);

  sheet.addRow(["Prospect", submission.prospectName ?? ""]);
  sheet.addRow(["Company", submission.companyName ?? ""]);
  sheet.addRow(["Email", submission.email ?? ""]);
  sheet.addRow(["Industry", submission.industry ?? ""]);
  sheet.addRow([
    "Submitted",
    submission.createdAt.toISOString().replace("T", " ").slice(0, 19),
  ]);
  sheet.addRow(["Question set", versionLabel]);
  sheet.addRow(["Wealth score", submission.wealthScore]);
  sheet.addRow(["Accounting score", submission.accountingScore]);
  sheet.addRow(["Value score", submission.valueScore]);
  sheet.addRow(["Earnings score", submission.earningsScore]);
  sheet.addRow(["Overall score", submission.overallScore]);
  sheet.addRow(["Readiness band", submission.readinessBand]);
  sheet.addRow(["Follow-up requested", followUpLabel(submission.followUpInterest)]);
  sheet.addRow([]);

  const headerRowNumber = sheet.rowCount + 1;
  const headerRow = sheet.addRow([
    "Question ID",
    "Gap",
    "Statement",
    "Answer",
    "Choice label",
    "Choice description",
    "Score",
    "Notes",
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND_MAROON },
    };
  });

  for (const q of questions) {
    const answer = answers[q.id];
    const level = answer !== undefined ? q.levels.find((l) => l.value === answer) : undefined;
    sheet.addRow([
      q.id,
      q.gap,
      q.statement,
      answer ?? "",
      level?.label ?? "",
      level?.description ?? "",
      answer !== undefined ? normalizeAnswer(answer, q.levels.length) : "",
      comments[q.id] ?? "",
    ]);
  }

  sheet.getColumn(3).width = 45;
  sheet.getColumn(5).width = 22;
  sheet.getColumn(6).width = 45;
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 12;
  // Notes hold a paragraph of the respondent's own writing, so it wraps
  // rather than running off behind the next column.
  sheet.getColumn(8).width = 55;
  sheet.getColumn(8).alignment = { wrapText: true, vertical: "top" };

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    if ((rowNumber - headerRowNumber) % 2 === 0) {
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
