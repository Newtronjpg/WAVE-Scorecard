import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import {
  ADVISOR_WRITE_WINDOW_MS,
  MAX_ADVISOR_NAME_LENGTH,
} from "@/lib/advisors";

// /api/advisors exists because the advisor section moved onto the results
// page, behind a button, after the row is already written and the completion
// email has already gone. Nothing else carries this answer -- no email, no
// submit body -- so these pin the write itself, not just the status code.
//
// It is public and unauthenticated for the same reason /api/follow-up is: the
// person answering has no account. What keeps that safe is that it can only
// ever write one column, on a row whose cuid the caller already had to know,
// inside a bounded window, on its own throttle bucket.

const updateManyMock = vi.fn();
const findUniqueMock = vi.fn().mockResolvedValue(null);
const upsertMock = vi.fn().mockResolvedValue({});

vi.mock("@/lib/db", () => ({
  db: {
    submission: {
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
    // Present so the throttle takes its allow path rather than failing open
    // through its error handler, which would pass these tests for the wrong
    // reason.
    rateLimit: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/advisors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What the route actually asked Prisma to write. */
function written() {
  return updateManyMock.mock.calls.at(-1)![0] as {
    where: { id: string; createdAt: { gt: Date } };
    data: { advisorRatings: unknown };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 1 });
  findUniqueMock.mockResolvedValue(null);
  upsertMock.mockResolvedValue({});
});

describe("POST /api/advisors", () => {
  it("records the ratings against the row it was given", async () => {
    const { POST } = await import("@/app/api/advisors/route");
    const res = await POST(
      post({
        submissionId: "sub_1",
        advisorRatings: {
          accounting: { rating: 2, name: "Smith LLP" },
          legal: { rating: 4 },
        },
      })
    );
    expect(res.status).toBe(200);
    expect(written().where.id).toBe("sub_1");
    expect(written().data.advisorRatings).toEqual({
      accounting: { rating: 2, name: "Smith LLP" },
      legal: { rating: 4 },
    });
  });

  it("keeps the good fields beside a bad one instead of discarding both", async () => {
    // An optional section must never be the reason a write fails. An unknown
    // area and an out-of-range rating are dropped; the real answer beside
    // them still lands.
    const { POST } = await import("@/app/api/advisors/route");
    const res = await POST(
      post({
        submissionId: "sub_1",
        advisorRatings: {
          accounting: { rating: 99 },
          astrology: { rating: 3 },
          banking: { rating: 1, name: "First National" },
        },
      })
    );
    expect(res.status).toBe(200);
    expect(written().data.advisorRatings).toEqual({
      banking: { rating: 1, name: "First National" },
    });
  });

  it("truncates an over-long adviser name rather than rejecting the answer", async () => {
    const { POST } = await import("@/app/api/advisors/route");
    const res = await POST(
      post({
        submissionId: "sub_1",
        advisorRatings: { legal: { rating: 3, name: "x".repeat(500) } },
      })
    );
    expect(res.status).toBe(200);
    const stored = written().data.advisorRatings as {
      legal: { name: string };
    };
    expect(stored.legal.name).toHaveLength(MAX_ADVISOR_NAME_LENGTH);
  });

  it("clears the column, not writes an empty object, when they clear everything", async () => {
    // Someone who opens the panel, rates an area, then taps it off again has
    // withdrawn the answer. "Said nothing" must have one representation.
    //
    // DbNull rather than a bare null: Prisma treats null on a Json field as
    // ambiguous between the JSON value `null` and SQL NULL and refuses it, so
    // DbNull is what actually empties the column.
    const { POST } = await import("@/app/api/advisors/route");
    const res = await POST(
      post({ submissionId: "sub_1", advisorRatings: { legal: { rating: undefined } } })
    );
    expect(res.status).toBe(200);
    expect(written().data.advisorRatings).toBe(Prisma.DbNull);
  });

  it("rejects a body that is not an advisor answer at all", async () => {
    const { POST } = await import("@/app/api/advisors/route");
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("404s on an id that matches nothing, without throwing", async () => {
    const { POST } = await import("@/app/api/advisors/route");
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await POST(
      post({ submissionId: "nope", advisorRatings: { legal: { rating: 3 } } })
    );
    expect(res.status).toBe(404);
  });

  it("only writes rows young enough to still be answering", async () => {
    // A cuid is the only thing authorising this write, and it is not a
    // security token. The age bound is what stops a guessed or replayed id
    // from being a permanent licence to rewrite someone's row.
    const { POST } = await import("@/app/api/advisors/route");
    const before = Date.now();
    await POST(post({ submissionId: "sub_1", advisorRatings: { legal: { rating: 3 } } }));
    const after = Date.now();

    const cutoff = written().where.createdAt.gt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - ADVISOR_WRITE_WINDOW_MS);
    expect(cutoff).toBeLessThanOrEqual(after - ADVISOR_WRITE_WINDOW_MS + 5);
  });

  it("says 503, not 404, when the database is the thing that failed", async () => {
    const { POST } = await import("@/app/api/advisors/route");
    updateManyMock.mockRejectedValueOnce(new Error("connection terminated"));
    const res = await POST(
      post({ submissionId: "sub_1", advisorRatings: { legal: { rating: 3 } } })
    );
    expect(res.status).toBe(503);
  });

  it("answers a missing row and an expired one identically", async () => {
    // Different responses would confirm to an unauthenticated caller that a
    // given id exists, which is the one thing the id is protecting.
    const { POST } = await import("@/app/api/advisors/route");
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const missing = await POST(
      post({ submissionId: "nope", advisorRatings: { legal: { rating: 3 } } })
    );
    updateManyMock.mockResolvedValueOnce({ count: 0 });
    const expired = await POST(
      post({ submissionId: "old", advisorRatings: { legal: { rating: 3 } } })
    );
    expect(missing.status).toBe(expired.status);
    expect(await missing.json()).toEqual(await expired.json());
  });

  it("throttles on its own bucket, not the submit or follow-up one", async () => {
    // Sharing a counter would mean rating your advisors could eat an attempt
    // at submitting the assessment -- or at answering the follow-up.
    const { POST } = await import("@/app/api/advisors/route");
    await POST(post({ submissionId: "sub_1", advisorRatings: { legal: { rating: 3 } } }));
    const key = findUniqueMock.mock.calls.at(-1)![0].where.key as string;
    expect(key.startsWith("advisors:")).toBe(true);
  });
});
