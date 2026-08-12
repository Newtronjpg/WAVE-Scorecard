import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { QUESTIONS } from "@/lib/questions";

// The submit route deliberately still returns a score to the person
// taking the assessment even when the database write fails -- five
// minutes of their work should not vanish because storage is down.
//
// What must NOT happen is what happened in production: the write failed,
// the error was swallowed, the response looked identical to a success,
// and every hosted submission was lost for a day with nobody notified.
// These tests pin the difference between "degraded but visible" and
// "silently losing data".

const createMock = vi.fn();
const alertMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { submission: { create: (...args: unknown[]) => createMock(...args) } },
}));

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendSubmissionNotification: (...args: unknown[]) => notifyMock(...args),
    sendPersistenceFailureAlert: (...args: unknown[]) => alertMock(...args),
  };
});

function completeAnswers(): Record<string, number> {
  return Object.fromEntries(QUESTIONS.map((q) => [q.id, 3]));
}

function submitRequest(body: unknown) {
  // NextRequest, not a bare Request: the route reads req.nextUrl.origin
  // to build the admin link, which only NextRequest provides.
  return new NextRequest("http://localhost:3000/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  answers: completeAnswers(),
  prospectName: "Jane Owner",
  companyName: "Acme Fabrication",
};

beforeEach(() => {
  createMock.mockReset();
  alertMock.mockReset();
  notifyMock.mockReset();
  notifyMock.mockResolvedValue({ sent: true });
  alertMock.mockResolvedValue({ sent: true });
});

describe("POST /api/submit when the database write succeeds", () => {
  it("reports the submission as saved", async () => {
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(submitRequest(validBody) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
  });

  it("does not raise a failure alert", async () => {
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/submit when the database write fails", () => {
  const dbDown = new Error(
    "The table `public.submissions` does not exist in the current database."
  );

  it("still returns the score so the prospect does not lose their results", async () => {
    createMock.mockRejectedValue(dbDown);
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(submitRequest(validBody) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.overallScore).toBe(50);
  });

  it("reports saved:false instead of looking identical to a success", async () => {
    createMock.mockRejectedValue(dbDown);
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(submitRequest(validBody) as never);
    const json = await res.json();

    expect(json.saved).toBe(false);
  });

  it("raises a failure alert carrying the answers that were lost", async () => {
    createMock.mockRejectedValue(dbDown);
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(alertMock).toHaveBeenCalledTimes(1);
    const details = alertMock.mock.calls[0][0];
    expect(details.prospectName).toBe("Jane Owner");
    expect(details.companyName).toBe("Acme Fabrication");
    expect(details.answers).toEqual(completeAnswers());
    expect(details.error).toBe(dbDown);
  });

  it("does not send the routine 'new submission' notification for a lost submission", async () => {
    // Sending the normal notification here would tell staff a submission
    // arrived and is waiting in the admin table, which is false.
    createMock.mockRejectedValue(dbDown);
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("still returns a response when the alert itself fails", async () => {
    createMock.mockRejectedValue(dbDown);
    alertMock.mockRejectedValue(new Error("smtp unreachable"));
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(submitRequest(validBody) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(false);
  });
});
