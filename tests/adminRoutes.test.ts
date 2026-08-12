import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { QUESTIONS } from "@/lib/questions";

const upsertSetting = vi.fn();
const deleteSubmission = vi.fn();
const upsertQuestion = vi.fn();
const deleteManyQuestion = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      upsert: (...a: unknown[]) => upsertSetting(...a),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    submission: { delete: (...a: unknown[]) => deleteSubmission(...a) },
    questionOverride: {
      upsert: (...a: unknown[]) => upsertQuestion(...a),
      deleteMany: (...a: unknown[]) => deleteManyQuestion(...a),
    },
  },
}));

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function validLevels() {
  return [1, 2, 3, 4, 5].map((v) => ({
    label: `Label ${v}`,
    description: `Description ${v}`,
  }));
}

beforeEach(() => {
  upsertSetting.mockReset().mockResolvedValue({});
  deleteSubmission.mockReset().mockResolvedValue({});
  upsertQuestion.mockReset().mockResolvedValue({});
  deleteManyQuestion.mockReset().mockResolvedValue({ count: 1 });
});

describe("POST /api/admin/settings", () => {
  const url = "http://localhost:3000/api/admin/settings";

  it("saves a normalized recipient list", async () => {
    const { POST } = await import("@/app/api/admin/settings/route");
    const res = await POST(
      jsonRequest(url, "POST", { recipients: " Owner@Example.com , Ben@Firm.com " })
    );

    expect(res.status).toBe(200);
    expect(upsertSetting).toHaveBeenCalledTimes(1);
    const arg = upsertSetting.mock.calls[0][0];
    expect(arg.create.value).toBe("owner@example.com, ben@firm.com");
  });

  it("rejects a malformed address without saving anything", async () => {
    const { POST } = await import("@/app/api/admin/settings/route");
    const res = await POST(
      jsonRequest(url, "POST", { recipients: "owner@example.com, oops" })
    );

    expect(res.status).toBe(400);
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it("accepts an empty list, meaning notifications off", async () => {
    const { POST } = await import("@/app/api/admin/settings/route");
    const res = await POST(jsonRequest(url, "POST", { recipients: "" }));

    expect(res.status).toBe(200);
    expect(upsertSetting.mock.calls[0][0].create.value).toBe("");
  });

  it("rejects a body with no recipients string", async () => {
    const { POST } = await import("@/app/api/admin/settings/route");
    const res = await POST(jsonRequest(url, "POST", { nope: true }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/submissions/[id]", () => {
  it("deletes the identified submission", async () => {
    const { DELETE } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await DELETE(
      jsonRequest("http://localhost:3000/api/admin/submissions/abc", "DELETE"),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(200);
    expect(deleteSubmission).toHaveBeenCalledWith({ where: { id: "abc" } });
  });

  it("returns 404 rather than 500 when the row is already gone", async () => {
    deleteSubmission.mockRejectedValue(Object.assign(new Error("nope"), { code: "P2025" }));
    const { DELETE } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await DELETE(
      jsonRequest("http://localhost:3000/api/admin/submissions/gone", "DELETE"),
      { params: Promise.resolve({ id: "gone" }) }
    );

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/admin/questions/[id]", () => {
  const id = QUESTIONS[0].id;
  const url = `http://localhost:3000/api/admin/questions/${id}`;

  it("saves a full override", async () => {
    const { PUT } = await import("@/app/api/admin/questions/[id]/route");
    const res = await PUT(
      jsonRequest(url, "PUT", { statement: "Rewritten.", levels: validLevels() }),
      { params: Promise.resolve({ id }) }
    );

    expect(res.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledTimes(1);
    const arg = upsertQuestion.mock.calls[0][0];
    expect(arg.create.statement).toBe("Rewritten.");
    expect(arg.create.levels).toHaveLength(5);
    expect(arg.create.levels[0].value).toBe(1);
  });

  it("returns 404 for a question id that does not exist", async () => {
    const { PUT } = await import("@/app/api/admin/questions/[id]/route");
    const res = await PUT(
      jsonRequest(url, "PUT", { statement: "x", levels: validLevels() }),
      { params: Promise.resolve({ id: "NOPE" }) }
    );

    expect(res.status).toBe(404);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("rejects an empty statement", async () => {
    const { PUT } = await import("@/app/api/admin/questions/[id]/route");
    const res = await PUT(
      jsonRequest(url, "PUT", { statement: "   ", levels: validLevels() }),
      { params: Promise.resolve({ id }) }
    );

    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("rejects fewer than five levels", async () => {
    const { PUT } = await import("@/app/api/admin/questions/[id]/route");
    const res = await PUT(
      jsonRequest(url, "PUT", { statement: "ok", levels: validLevels().slice(0, 4) }),
      { params: Promise.resolve({ id }) }
    );

    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("ignores any attempt to set a tier, keeping tiers structural", async () => {
    const { PUT } = await import("@/app/api/admin/questions/[id]/route");
    await PUT(
      jsonRequest(url, "PUT", {
        statement: "ok",
        levels: validLevels().map((l) => ({ ...l, tier: "Excellent" })),
      }),
      { params: Promise.resolve({ id }) }
    );

    const saved = upsertQuestion.mock.calls[0][0].create.levels;
    expect(saved.every((l: Record<string, unknown>) => !("tier" in l))).toBe(true);
  });
});

describe("DELETE /api/admin/questions/[id]", () => {
  it("removes the override, restoring the default wording", async () => {
    const id = QUESTIONS[0].id;
    const { DELETE } = await import("@/app/api/admin/questions/[id]/route");
    const res = await DELETE(
      jsonRequest(`http://localhost:3000/api/admin/questions/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) }
    );

    expect(res.status).toBe(200);
    expect(deleteManyQuestion).toHaveBeenCalledWith({ where: { questionId: id } });
  });

  it("returns 404 for an unknown question id", async () => {
    const { DELETE } = await import("@/app/api/admin/questions/[id]/route");
    const res = await DELETE(
      jsonRequest("http://localhost:3000/api/admin/questions/NOPE", "DELETE"),
      { params: Promise.resolve({ id: "NOPE" }) }
    );

    expect(res.status).toBe(404);
    expect(deleteManyQuestion).not.toHaveBeenCalled();
  });
});
