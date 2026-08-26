import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { QUESTIONS } from "@/lib/questions";

// Preview scoring's whole reason for existing separately from
// /api/submit: it lets a draft be score-tested before it goes live, and
// it must share none of /api/submit's side effects. If this route ever
// starts writing a row or sending an email, that is a bug -- these tests
// exist specifically to catch that.

const createMock = vi.fn();
const notifyMock = vi.fn();
const getDraftQuestionsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    submission: { create: (...args: unknown[]) => createMock(...args) },
  },
}));

vi.mock("@/lib/questionContent", () => ({
  getDraftQuestions: (...args: unknown[]) => getDraftQuestionsMock(...args),
}));

vi.mock("@/lib/email", () => ({
  sendSubmissionNotification: (...args: unknown[]) => notifyMock(...args),
}));

function completeAnswers(): Record<string, number> {
  return Object.fromEntries(QUESTIONS.map((q) => [q.id, 3]));
}

function previewRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/preview-score", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getDraftQuestionsMock.mockResolvedValue({
    questions: QUESTIONS,
    updatedAt: new Date("2026-08-18T00:00:00Z"),
    source: "draft",
  });
});

describe("POST /api/admin/preview-score", () => {
  it("scores against the draft set, not the published one", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const res = await POST(previewRequest({ answers: completeAnswers() }) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(getDraftQuestionsMock).toHaveBeenCalledTimes(1);
    expect(typeof json.overallScore).toBe("number");
  });

  it("tolerates the per-question comments the shared Assessment component sends", async () => {
    // /admin/preview reuses components/Assessment.tsx pointed at this
    // route, so this endpoint receives whatever the real assessment
    // posts -- comments included. It must ignore them, not 400, or
    // adding a field to the public form silently breaks admin preview.
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const res = await POST(
      previewRequest({
        answers: completeAnswers(),
        comments: { W1: "context typed during a preview" },
        prospectName: "Preview",
        companyName: "Preview",
        questionSetVersion: null,
      }) as never
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.overallScore).toBe("number");
  });

  it("never writes a submission row", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    await POST(previewRequest({ answers: completeAnswers() }) as never);

    expect(createMock).not.toHaveBeenCalled();
  });

  it("never sends the submission notification email", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    await POST(previewRequest({ answers: completeAnswers() }) as never);

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("marks the response as a preview so the client cannot mistake it for a real submission", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const res = await POST(previewRequest({ answers: completeAnswers() }) as never);
    const json = await res.json();

    expect(json.preview).toBe(true);
  });

  it("returns 400 for an incomplete answer map", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const partial = completeAnswers();
    delete partial[QUESTIONS[0].id];
    const res = await POST(previewRequest({ answers: partial }) as never);

    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a rating above a question's own choice count, not a hardcoded 5", async () => {
    const truncated = QUESTIONS.map((q) =>
      q.id === QUESTIONS[0].id ? { ...q, levels: q.levels.slice(0, 3) } : q
    );
    getDraftQuestionsMock.mockResolvedValue({
      questions: truncated,
      updatedAt: new Date("2026-08-18T00:00:00Z"),
      source: "draft",
    });
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const res = await POST(
      previewRequest({
        answers: { ...completeAnswers(), [QUESTIONS[0].id]: 4 },
      }) as never
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 with a readable message rather than a 500 when the draft cannot be read at all", async () => {
    getDraftQuestionsMock.mockRejectedValue(new Error("connection refused"));
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const res = await POST(previewRequest({ answers: completeAnswers() }) as never);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(typeof json.error).toBe("string");
    expect(json.error.length).toBeGreaterThan(0);
  });

  it("returns 400 for a malformed JSON body rather than throwing", async () => {
    const { POST } = await import("@/app/api/admin/preview-score/route");
    const req = new NextRequest("http://localhost/api/admin/preview-score", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req as never);

    expect(res.status).toBe(400);
  });
});
