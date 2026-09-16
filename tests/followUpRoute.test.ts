import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MAX_FOLLOW_UP_NOTE_LENGTH } from "@/lib/followUp";

// /api/follow-up exists because the question moved to the results page, which
// is after the row is written and after the completion email has gone. It is
// the ONLY path by which the answer reaches anybody -- no email carries it --
// so these pin the write itself, not just the status code.

const updateMock = vi.fn();
const findUniqueMock = vi.fn().mockResolvedValue(null);
const upsertMock = vi.fn().mockResolvedValue({});

vi.mock("@/lib/db", () => ({
  db: {
    submission: { update: (...args: unknown[]) => updateMock(...args) },
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
  return new NextRequest("http://localhost:3000/api/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What the route actually asked Prisma to write. */
function written() {
  return updateMock.mock.calls.at(-1)![0] as {
    where: { id: string };
    data: { followUpInterest: boolean | null; followUpNote: string | null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockResolvedValue({ id: "sub_1" });
  findUniqueMock.mockResolvedValue(null);
  upsertMock.mockResolvedValue({});
});

describe("POST /api/follow-up", () => {
  it("records a yes against the row it was given", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(
      post({ submissionId: "sub_1", followUpInterest: true, followUpNote: "Timing." })
    );
    expect(res.status).toBe(200);
    expect(written().where).toEqual({ id: "sub_1" });
    expect(written().data).toEqual({ followUpInterest: true, followUpNote: "Timing." });
  });

  it("stores null when they un-answer, rather than ignoring it", async () => {
    // Re-tapping a choice clears it. That has to be storable, or the column
    // keeps an answer the person has visibly withdrawn.
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(post({ submissionId: "sub_1", followUpInterest: null }));
    expect(written().data.followUpInterest).toBeNull();
  });

  it("drops a note that arrives with anything other than a yes", async () => {
    // Keeping it would put words in the mouth of someone who just declined.
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(
      post({ submissionId: "sub_1", followUpInterest: false, followUpNote: "Call me." })
    );
    expect(written().data).toEqual({ followUpInterest: false, followUpNote: null });
  });

  it("trims a note, and stores an empty one as null", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(
      post({ submissionId: "sub_1", followUpInterest: true, followUpNote: "  spaced  " })
    );
    expect(written().data.followUpNote).toBe("spaced");

    await POST(
      post({ submissionId: "sub_1", followUpInterest: true, followUpNote: "   " })
    );
    expect(written().data.followUpNote).toBeNull();
  });

  it("truncates an over-long note instead of rejecting the answer", async () => {
    // The answer is what staff act on. A pasted essay must never be the reason
    // a "yes" fails to record.
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(
      post({
        submissionId: "sub_1",
        followUpInterest: true,
        followUpNote: "x".repeat(MAX_FOLLOW_UP_NOTE_LENGTH * 3),
      })
    );
    expect(res.status).toBe(200);
    expect(written().data.followUpNote).toHaveLength(MAX_FOLLOW_UP_NOTE_LENGTH);
  });

  it("rejects a body that is not a follow-up at all", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ submissionId: "sub_1" }))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("404s on an id that does not exist, without throwing", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    updateMock.mockRejectedValueOnce(new Error("Record to update not found."));
    const res = await POST(post({ submissionId: "nope", followUpInterest: true }));
    expect(res.status).toBe(404);
  });

  it("throttles on its own bucket, not the submit one", async () => {
    // If these shared a counter, answering the follow-up would eat an attempt
    // at submitting -- and hammering this endpoint would lock a real prospect
    // out of the assessment entirely.
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(post({ submissionId: "sub_1", followUpInterest: true }));
    const key = findUniqueMock.mock.calls.at(-1)![0].where.key as string;
    expect(key.startsWith("follow-up:")).toBe(true);
  });
});
