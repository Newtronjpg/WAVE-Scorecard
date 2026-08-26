import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The follow-up answer is given on the results page, after the submission
// row already exists, so it arrives through its own endpoint. These tests
// pin the two things that matter: the answer is recorded against the right
// row, and a "yes" actually reaches staff -- the results page has already
// promised the respondent a call by the time this runs.

const updateMock = vi.fn();
const followUpMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    submission: { update: (...args: unknown[]) => updateMock(...args) },
    rateLimit: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    setting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendFollowUpRequest: (...a: unknown[]) => followUpMock(...a) };
});

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROW = {
  prospectName: "Jane Owner",
  companyName: "Acme Fabrication",
  email: "jane@acme.com",
  industry: "Manufacturing",
  overallScore: 67,
  readinessBand: "Good",
};

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue(ROW);
  followUpMock.mockReset().mockResolvedValue({ sent: true });
});

describe("POST /api/follow-up", () => {
  it("records a yes against the submission it names", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(request({ submissionId: "sub-1", interested: true }) as never);

    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].where).toEqual({ id: "sub-1" });
    expect(updateMock.mock.calls[0][0].data).toEqual({ followUpInterest: true });
  });

  it("records a no without emailing anyone", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(request({ submissionId: "sub-1", interested: false }) as never);

    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0].data).toEqual({ followUpInterest: false });
    expect(followUpMock).not.toHaveBeenCalled();
  });

  it("emails staff on a yes, since the respondent was already promised a call", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(request({ submissionId: "sub-1", interested: true }) as never);

    expect(followUpMock).toHaveBeenCalledTimes(1);
    const sent = followUpMock.mock.calls[0][0];
    expect(sent.prospectName).toBe("Jane Owner");
    expect(sent.email).toBe("jane@acme.com");
    expect(sent.overallScore).toBe(67);
  });

  it("only ever writes the one boolean, never anything else on the row", async () => {
    const { POST } = await import("@/app/api/follow-up/route");
    await POST(request({
      submissionId: "sub-1",
      interested: true,
      // A caller trying to ride along on the update.
      overallScore: 100,
      prospectName: "Someone Else",
      answers: { W1: 5 },
    }) as never);

    expect(Object.keys(updateMock.mock.calls[0][0].data)).toEqual(["followUpInterest"]);
  });

  it("still succeeds when the notification email fails", async () => {
    // The answer is stored and visible in the admin table; a mail problem
    // must not surface to the person who just asked to be contacted.
    followUpMock.mockRejectedValue(new Error("smtp down"));
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(request({ submissionId: "sub-1", interested: true }) as never);

    expect(res.status).toBe(200);
  });

  it("gives an unknown id the same generic 400 as a malformed body", async () => {
    // A distinct "no such submission" would let anyone test whether an id
    // exists, one guess at a time.
    updateMock.mockRejectedValue(new Error("Record to update not found"));
    const { POST } = await import("@/app/api/follow-up/route");
    const unknown = await POST(request({ submissionId: "nope", interested: true }) as never);
    const malformed = await POST(request({ submissionId: "", interested: "yes" }) as never);

    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(await unknown.json()).toEqual(await malformed.json());
  });

  it.each([
    ["a missing id", { interested: true }],
    ["a non-boolean answer", { submissionId: "sub-1", interested: "yes" }],
    ["a missing answer", { submissionId: "sub-1" }],
  ])("rejects %s without touching the database", async (_label, body) => {
    const { POST } = await import("@/app/api/follow-up/route");
    const res = await POST(request(body) as never);

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
