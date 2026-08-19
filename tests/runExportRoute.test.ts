import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { toStored, withDerivedTiers } from "@/lib/questionSet";
import { QUESTIONS } from "@/lib/questions";

const findUniqueSubmission = vi.fn();
const findUniqueVersion = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    submission: { findUnique: (...a: unknown[]) => findUniqueSubmission(...a) },
    questionSetVersion: { findUnique: (...a: unknown[]) => findUniqueVersion(...a) },
  },
}));

function fakeSubmission(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    createdAt: new Date("2026-03-01T12:00:00Z"),
    prospectName: "Jane Owner",
    companyName: "Acme Fabrication, Inc.",
    answers: { W1: 3 },
    wealthScore: 50,
    accountingScore: 75,
    valueScore: 50,
    earningsScore: 57,
    overallScore: 58,
    readinessBand: "Meaningful gaps",
    questionSetVersion: null,
    questionSetSnapshot: null,
    ...overrides,
  };
}

async function loadFirstSheetText(res: Response) {
  const buffer = await res.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  return JSON.stringify(workbook.worksheets[0].getSheetValues());
}

beforeEach(() => {
  findUniqueSubmission.mockReset();
  findUniqueVersion.mockReset();
});

describe("GET /api/admin/submissions/[id]/export", () => {
  const req = new NextRequest("http://localhost:3000/api/admin/submissions/sub-1/export");
  const params = Promise.resolve({ id: "sub-1" });

  it("404s when the submission does not exist", async () => {
    findUniqueSubmission.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/submissions/[id]/export/route");
    const res = await GET(req as never, { params } as never);
    expect(res.status).toBe(404);
  });

  it("prefers the literal snapshot over resolving the version", async () => {
    const snapshot = toStored(withDerivedTiers([
      {
        id: "W1",
        gap: "wealth",
        statement: "Snapshot statement.",
        levels: [
          { value: 1, label: "L1", description: "D1" },
          { value: 2, label: "L2", description: "D2" },
          { value: 3, label: "L3", description: "D3" },
        ],
      },
    ]));
    findUniqueSubmission.mockResolvedValue(
      fakeSubmission({ questionSetVersion: 3, questionSetSnapshot: snapshot })
    );
    const { GET } = await import("@/app/api/admin/submissions/[id]/export/route");
    const res = await GET(req as never, { params } as never);

    expect(res.status).toBe(200);
    expect(findUniqueVersion).not.toHaveBeenCalled();
    const text = await loadFirstSheetText(res);
    expect(text).toContain("Snapshot statement.");
    expect(text).toContain("version 3");
  });

  it("falls back to the QuestionSetVersion table when there is no snapshot", async () => {
    findUniqueSubmission.mockResolvedValue(
      fakeSubmission({ questionSetVersion: 2, questionSetSnapshot: null })
    );
    findUniqueVersion.mockResolvedValue({
      version: 2,
      questions: toStored(QUESTIONS),
      note: null,
      publishedAt: new Date(),
    });
    const { GET } = await import("@/app/api/admin/submissions/[id]/export/route");
    const res = await GET(req as never, { params } as never);

    expect(res.status).toBe(200);
    expect(findUniqueVersion).toHaveBeenCalledWith({ where: { version: 2 } });
    const text = await loadFirstSheetText(res);
    expect(text).toContain("version 2");
  });

  it("falls back to the factory set, labeled, when there is no snapshot and no resolvable version", async () => {
    findUniqueSubmission.mockResolvedValue(
      fakeSubmission({ questionSetVersion: null, questionSetSnapshot: null })
    );
    const { GET } = await import("@/app/api/admin/submissions/[id]/export/route");
    const res = await GET(req as never, { params } as never);

    expect(res.status).toBe(200);
    expect(findUniqueVersion).not.toHaveBeenCalled();
    const text = await loadFirstSheetText(res);
    expect(text).toContain("factory (version not recorded)");
  });

  it("sanitizes the company name in the filename", async () => {
    findUniqueSubmission.mockResolvedValue(
      fakeSubmission({ companyName: "Acme & Sons / Fabrication!" })
    );
    const { GET } = await import("@/app/api/admin/submissions/[id]/export/route");
    const res = await GET(req as never, { params } as never);

    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="wave-[a-z0-9-]+-2026-03-01\.xlsx"$/);
  });
});
