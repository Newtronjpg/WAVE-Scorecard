import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { factoryQuestionSet } from "@/lib/questionSet";

// Whole-set operations for the admin question editor: read/replace the
// draft, publish it as an immutable numbered version, roll back to an
// older version, and reset the draft. Add/delete/reorder are all just "a
// new array" through PUT /draft, which is what makes them atomic.
//
// Every model touched by any route under test is stubbed here, even when
// a given test doesn't exercise it -- an unstubbed model call throws,
// which would make a test "pass" by falling into a swallowed crash path
// instead of the path it claims to test. See tests/submitRoute.test.ts
// lines 22-24 for the incident this guards against.

const findUniqueDraftMock = vi.fn();
const upsertDraftMock = vi.fn();
const findFirstVersionMock = vi.fn();
const findUniqueVersionMock = vi.fn();
const findManyVersionMock = vi.fn();
const createVersionMock = vi.fn();
const deleteVersionMock = vi.fn();
const findManyOverrideMock = vi.fn();
const updateManyVersionMock = vi.fn();
const updateVersionMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    questionDraft: {
      findUnique: (...args: unknown[]) => findUniqueDraftMock(...args),
      upsert: (...args: unknown[]) => upsertDraftMock(...args),
    },
    questionSetVersion: {
      findFirst: (...args: unknown[]) => findFirstVersionMock(...args),
      findUnique: (...args: unknown[]) => findUniqueVersionMock(...args),
      findMany: (...args: unknown[]) => findManyVersionMock(...args),
      create: (...args: unknown[]) => createVersionMock(...args),
      delete: (...args: unknown[]) => deleteVersionMock(...args),
      updateMany: (...args: unknown[]) => updateManyVersionMock(...args),
      update: (...args: unknown[]) => updateVersionMock(...args),
    },
    questionOverride: {
      findMany: (...args: unknown[]) => findManyOverrideMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const FACTORY = factoryQuestionSet();

beforeEach(() => {
  findUniqueDraftMock.mockReset().mockResolvedValue(null);
  upsertDraftMock.mockReset().mockResolvedValue({
    id: "draft",
    questions: FACTORY,
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  findFirstVersionMock.mockReset().mockResolvedValue(null);
  findUniqueVersionMock.mockReset().mockResolvedValue(null);
  findManyVersionMock.mockReset().mockResolvedValue([]);
  createVersionMock.mockReset().mockResolvedValue({});
  deleteVersionMock.mockReset().mockResolvedValue({});
  updateManyVersionMock.mockReset().mockResolvedValue({});
  updateVersionMock.mockReset().mockResolvedValue({});
  transactionMock.mockReset().mockResolvedValue([]);
  findManyOverrideMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/admin/questions/draft", () => {
  it("returns the draft questions, its updatedAt, and the published version", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    findFirstVersionMock.mockResolvedValue({
      version: 4,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });

    const { GET } = await import("@/app/api/admin/questions/draft/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updatedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(json.publishedVersion).toBe(4);
    expect(json.questions).toHaveLength(FACTORY.length);
  });

  it("includes source so a client can tell a real draft from a degraded fallback", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/questions/draft/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.source).toBe("draft");
  });

  it('reports source "draft" (not "factory") when the draft row exists but is unreadable', async () => {
    // A draft row EXISTS but fails validateQuestionSet -- getDraftQuestions
    // still serves the published/factory content as a safe fallback, but
    // must report source "draft" (with updatedAt null) rather than
    // "factory"/"published", so a caller can tell "a draft exists but
    // couldn't be read" apart from "no draft was ever written". See
    // lib/questionContent.ts's getDraftQuestions and
    // tests/questionContent.test.ts for the full contract this pins.
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: [],
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/questions/draft/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.source).toBe("draft");
    expect(json.updatedAt).toBeNull();
  });

  it('reports source "factory" when there is no draft row at all and nothing is published', async () => {
    // Distinct from the corrupt-row case above: no row exists here, so
    // there is genuinely nothing to conflict with, and source must say so.
    findUniqueDraftMock.mockResolvedValue(null);
    findFirstVersionMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/questions/draft/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.source).toBe("factory");
    expect(json.updatedAt).toBeNull();
  });
});

describe("PUT /api/admin/questions/draft", () => {
  const url = "http://localhost:3000/api/admin/questions/draft";

  it("saves a valid set and returns the new updatedAt", async () => {
    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(jsonRequest(url, "PUT", { questions: FACTORY }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid set with 400 and writes nothing", async () => {
    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(jsonRequest(url, "PUT", { questions: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.errors.length).toBeGreaterThan(0);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });

  it("returns 400 listing every validation error, not just the first", async () => {
    // Empty set: fails validation once per gap (four gaps), so this
    // alone proves multiple errors are collected, not just the first.
    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(jsonRequest(url, "PUT", { questions: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.errors.length).toBeGreaterThan(1);
  });

  it("returns 409 when the submitted updatedAt is older than the stored one, and writes nothing", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(
      jsonRequest(url, "PUT", {
        questions: FACTORY,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
    );

    expect(res.status).toBe(409);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });

  it("accepts the write when updatedAt matches", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(
      jsonRequest(url, "PUT", {
        questions: FACTORY,
        updatedAt: "2026-01-05T00:00:00.000Z",
      })
    );

    expect(res.status).toBe(200);
    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the write when the stored draft does not exist yet", async () => {
    findUniqueDraftMock.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(
      jsonRequest(url, "PUT", {
        questions: FACTORY,
        updatedAt: "2026-01-05T00:00:00.000Z",
      })
    );

    expect(res.status).toBe(200);
    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the write when the stored draft does not exist yet and updatedAt is omitted", async () => {
    findUniqueDraftMock.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(jsonRequest(url, "PUT", { questions: FACTORY }));

    expect(res.status).toBe(200);
    expect(upsertDraftMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and writes nothing when a draft row exists but updatedAt is omitted", async () => {
    // RULING A: once a draft row exists, a matching updatedAt is required.
    // Omitting the field must not be treated as "no conflict possible" --
    // that is exactly the escape hatch that let a client blind-overwrite a
    // real (possibly corrupt-and-unreadable) row. See getDraftQuestions's
    // comment in lib/questionContent.ts on why null is ambiguous.
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(jsonRequest(url, "PUT", { questions: FACTORY }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/reload/i);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });

  it("returns 409 and writes nothing when a draft row exists but updatedAt is explicitly null", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const { PUT } = await import("@/app/api/admin/questions/draft/route");
    const res = await PUT(
      jsonRequest(url, "PUT", { questions: FACTORY, updatedAt: null })
    );

    expect(res.status).toBe(409);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/questions/publish", () => {
  const url = "http://localhost:3000/api/admin/questions/publish";

  it("writes a QuestionSetVersion whose questions equal the draft's", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date(),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    const res = await POST(jsonRequest(url, "POST", {}));

    expect(res.status).toBe(200);
    expect(createVersionMock).toHaveBeenCalledTimes(1);
    const arg = createVersionMock.mock.calls[0][0];
    expect(arg.data.questions).toEqual(FACTORY);
  });

  it("numbers the first publish 1", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date(),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    const res = await POST(jsonRequest(url, "POST", {}));
    const json = await res.json();

    expect(json.version).toBe(1);
    expect(createVersionMock.mock.calls[0][0].data.version).toBe(1);
  });

  it("numbers a later publish one above the current highest, not count + 1", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date(),
    });
    // Simulates a gap in the sequence: only two rows exist, but the
    // highest is 7. count + 1 would produce 3 and collide.
    findFirstVersionMock.mockResolvedValue({
      version: 7,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    const res = await POST(jsonRequest(url, "POST", {}));
    const json = await res.json();

    expect(json.version).toBe(8);
  });

  it("refuses with 400 and publishes nothing when the draft fails validation", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: [],
      updatedAt: new Date(),
    });

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    const res = await POST(jsonRequest(url, "POST", {}));

    expect(res.status).toBe(400);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("stores the supplied note", async () => {
    findUniqueDraftMock.mockResolvedValue({
      id: "draft",
      questions: FACTORY,
      updatedAt: new Date(),
    });
    findFirstVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    await POST(jsonRequest(url, "POST", { note: "Adding two new questions." }));

    expect(createVersionMock.mock.calls[0][0].data.note).toBe(
      "Adding two new questions."
    );
  });

  it("refuses with 400 and publishes nothing when there is no draft row", async () => {
    // RULING B: the fallback to getDraftQuestions() is gone. Publish must
    // refuse rather than silently ship content the admin never opened
    // (and that bypasses validateQuestionSet's guarantees, since
    // factoryWithOverrides is not revalidated).
    findUniqueDraftMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/publish/route");
    const res = await POST(jsonRequest(url, "POST", {}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Save the draft before publishing.");
    expect(createVersionMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/questions/rollback", () => {
  const url = "http://localhost:3000/api/admin/questions/rollback";

  it("appends a new version carrying the target version's questions", async () => {
    findUniqueVersionMock.mockResolvedValue({
      version: 3,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });
    findFirstVersionMock.mockResolvedValue({
      version: 5,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });

    const { POST } = await import("@/app/api/admin/questions/rollback/route");
    const res = await POST(jsonRequest(url, "POST", { version: 3 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.version).toBe(6);
    const arg = createVersionMock.mock.calls[0][0];
    expect(arg.data.version).toBe(6);
    expect(arg.data.questions).toEqual(FACTORY);
  });

  it("leaves the target version row untouched", async () => {
    // questionSetVersion is stubbed with only findUnique/findFirst/create
    // (see the vi.mock above) -- no update or delete method exists on the
    // mock, so any attempt by the route to mutate the target row would
    // throw and fail this test.
    findUniqueVersionMock.mockResolvedValue({
      version: 3,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });
    findFirstVersionMock.mockResolvedValue({
      version: 3,
      questions: FACTORY,
      note: null,
      publishedAt: new Date(),
    });

    const { POST } = await import("@/app/api/admin/questions/rollback/route");
    const res = await POST(jsonRequest(url, "POST", { version: 3 }));

    expect(res.status).toBe(200);
    expect(createVersionMock.mock.calls[0][0].data.version).not.toBe(3);
  });

  it("returns 404 for a version that does not exist", async () => {
    findUniqueVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/rollback/route");
    const res = await POST(jsonRequest(url, "POST", { version: 999 }));

    expect(res.status).toBe(404);
    expect(createVersionMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/questions/versions", () => {
  // Backs components/VersionHistory.tsx's rollback UI (RULING D, Task 7
  // fix round 1). Read-only, metadata only -- version, note, publishedAt
  // -- never the (large, unused here) `questions` column.

  it("lists every version newest-first with its note and timestamp", async () => {
    const publishedAt3 = new Date("2026-01-01T00:00:00.000Z");
    const publishedAt5 = new Date("2026-01-05T00:00:00.000Z");
    findManyVersionMock.mockResolvedValue([
      { version: 5, note: "Reworded W3.", publishedAt: publishedAt5, isDefault: false },
      { version: 3, note: null, publishedAt: publishedAt3, isDefault: true },
    ]);

    const { GET } = await import("@/app/api/admin/questions/versions/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.versions).toEqual([
      {
        version: 5,
        note: "Reworded W3.",
        publishedAt: publishedAt5.toISOString(),
        isDefault: false,
      },
      {
        version: 3,
        note: null,
        publishedAt: publishedAt3.toISOString(),
        isDefault: true,
      },
    ]);
    expect(findManyVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { version: "desc" },
        select: { version: true, note: true, publishedAt: true, isDefault: true },
      })
    );
  });

  it("returns an empty list when nothing has ever been published", async () => {
    findManyVersionMock.mockResolvedValue([]);

    const { GET } = await import("@/app/api/admin/questions/versions/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.versions).toEqual([]);
  });

  it("returns 500 with a readable error on a read failure", async () => {
    findManyVersionMock.mockRejectedValue(new Error("db unreachable"));

    const { GET } = await import("@/app/api/admin/questions/versions/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(typeof json.error).toBe("string");
  });
});

describe("DELETE /api/admin/questions/versions/[version]", () => {
  function params(version: string) {
    return Promise.resolve({ version });
  }

  it("deletes a version that is not the live one", async () => {
    findFirstVersionMock.mockResolvedValue({ version: 5 });
    const { DELETE } = await import(
      "@/app/api/admin/questions/versions/[version]/route"
    );
    const res = await DELETE({} as never, { params: params("3") });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(deleteVersionMock).toHaveBeenCalledWith({ where: { version: 3 } });
  });

  it("refuses to delete the currently live version, and writes nothing", async () => {
    findFirstVersionMock.mockResolvedValue({ version: 5 });
    const { DELETE } = await import(
      "@/app/api/admin/questions/versions/[version]/route"
    );
    const res = await DELETE({} as never, { params: params("5") });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(typeof json.error).toBe("string");
    expect(deleteVersionMock).not.toHaveBeenCalled();
  });

  it("returns 404, not 500, when the version does not exist", async () => {
    findFirstVersionMock.mockResolvedValue({ version: 5 });
    deleteVersionMock.mockRejectedValue({ code: "P2025" });
    const { DELETE } = await import(
      "@/app/api/admin/questions/versions/[version]/route"
    );
    const res = await DELETE({} as never, { params: params("99") });

    expect(res.status).toBe(404);
  });

  it("returns 400 for a non-numeric version", async () => {
    const { DELETE } = await import(
      "@/app/api/admin/questions/versions/[version]/route"
    );
    const res = await DELETE({} as never, { params: params("not-a-number") });

    expect(res.status).toBe(400);
    expect(deleteVersionMock).not.toHaveBeenCalled();
  });

  it("returns 500 on an unexpected failure", async () => {
    findFirstVersionMock.mockResolvedValue({ version: 5 });
    deleteVersionMock.mockRejectedValue(new Error("db unreachable"));
    const { DELETE } = await import(
      "@/app/api/admin/questions/versions/[version]/route"
    );
    const res = await DELETE({} as never, { params: params("3") });

    expect(res.status).toBe(500);
  });
});

describe("POST /api/admin/questions/reset-draft", () => {
  const url = "http://localhost:3000/api/admin/questions/reset-draft";

  it('to: "factory" overwrites the draft with the factory set', async () => {
    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "factory" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(upsertDraftMock.mock.calls[0][0].create.questions).toEqual(FACTORY);
  });

  it('to: "live" overwrites the draft with the highest published version', async () => {
    const publishedQuestions = FACTORY.map((q) =>
      q.id === FACTORY[0].id ? { ...q, statement: "Published wording." } : q
    );
    findFirstVersionMock.mockResolvedValue({
      version: 4,
      questions: publishedQuestions,
      note: null,
      publishedAt: new Date(),
    });

    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "live" }));

    expect(res.status).toBe(200);
    const saved = upsertDraftMock.mock.calls[0][0].create.questions;
    expect(saved[0].statement).toBe("Published wording.");
  });

  it('to: "live" with nothing published falls back to the factory set', async () => {
    findFirstVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "live" }));

    expect(res.status).toBe(200);
    expect(upsertDraftMock.mock.calls[0][0].create.questions).toEqual(FACTORY);
  });

  it('to: "default" overwrites the draft with the admin-designated default version', async () => {
    const defaultQuestions = FACTORY.map((q) =>
      q.id === FACTORY[0].id ? { ...q, statement: "The real default wording." } : q
    );
    findFirstVersionMock.mockResolvedValue({
      version: 2,
      questions: defaultQuestions,
      note: "Our default",
      publishedAt: new Date(),
      isDefault: true,
    });

    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "default" }));

    expect(res.status).toBe(200);
    expect(findFirstVersionMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isDefault: true } })
    );
    const saved = upsertDraftMock.mock.calls[0][0].create.questions;
    expect(saved[0].statement).toBe("The real default wording.");
  });

  it('to: "default" with nothing designated falls back to the factory set', async () => {
    findFirstVersionMock.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "default" }));

    expect(res.status).toBe(200);
    expect(upsertDraftMock.mock.calls[0][0].create.questions).toEqual(FACTORY);
  });

  it("rejects a `to` value that isn't live, default, or factory", async () => {
    const { POST } = await import("@/app/api/admin/questions/reset-draft/route");
    const res = await POST(jsonRequest(url, "POST", { to: "nonsense" }));

    expect(res.status).toBe(400);
    expect(upsertDraftMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/questions/versions/[version]/default", () => {
  function params(version: string) {
    return Promise.resolve({ version });
  }

  it("marks the target version as default, unsetting any previous default first", async () => {
    findUniqueVersionMock.mockResolvedValue({ version: 3 });
    const { POST } = await import(
      "@/app/api/admin/questions/versions/[version]/default/route"
    );
    const res = await POST({} as never, { params: params("3") });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    const ops = transactionMock.mock.calls[0][0];
    expect(ops.length).toBe(2);
  });

  it("returns 404 for a version that does not exist", async () => {
    findUniqueVersionMock.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/admin/questions/versions/[version]/default/route"
    );
    const res = await POST({} as never, { params: params("99") });

    expect(res.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric version", async () => {
    const { POST } = await import(
      "@/app/api/admin/questions/versions/[version]/default/route"
    );
    const res = await POST({} as never, { params: params("nope") });

    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 500 on an unexpected failure", async () => {
    findUniqueVersionMock.mockResolvedValue({ version: 3 });
    transactionMock.mockRejectedValue(new Error("db unreachable"));
    const { POST } = await import(
      "@/app/api/admin/questions/versions/[version]/default/route"
    );
    const res = await POST({} as never, { params: params("3") });

    expect(res.status).toBe(500);
  });
});
