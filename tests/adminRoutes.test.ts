import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

