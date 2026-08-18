import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { QUESTIONS } from "@/lib/questions";
import { toStored, withDerivedTiers } from "@/lib/questionSet";

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
const getPublishedQuestionsMock = vi.fn();
const getQuestionsForVersionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    submission: { create: (...args: unknown[]) => createMock(...args) },
    // Present so the throttle takes its normal allow path rather than
    // failing open through its error handler, which would make these
    // tests pass for the wrong reason.
    rateLimit: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    setting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

// The route resolves a known question set instead of reading the
// database directly. getQuestionsForVersion is stubbed separately (not
// just getPublishedQuestions) because the version-travel tests below
// need to prove the route calls the RIGHT one depending on whether the
// request carries a questionSetVersion.
vi.mock("@/lib/questionContent", () => ({
  getPublishedQuestions: (...args: unknown[]) => getPublishedQuestionsMock(...args),
  getQuestionsForVersion: (...args: unknown[]) => getQuestionsForVersionMock(...args),
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
  getPublishedQuestionsMock.mockReset().mockResolvedValue({
    questions: QUESTIONS,
    version: 3,
  });
  getQuestionsForVersionMock.mockReset();
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

// The question set is now resolved per request against the PUBLISHED
// version rather than the fixed lib/questions.ts import, and the bound
// on each rating is that question's own choice count rather than a
// hardcoded 1-5.
describe("POST /api/submit and the published question set", () => {
  it("records which published question set the run answered", async () => {
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(createMock.mock.calls[0][0].data.questionSetVersion).toBe(3);
  });

  it("stores a snapshot of the literal question set the run was scored against", async () => {
    // Task 5 review I2: a null questionSetVersion is ambiguous about what
    // was actually asked. questionSetSnapshot fixes that by carrying the
    // full stored question set (id, gap, statement, levels) on the row
    // itself, so no join back to QuestionSetVersion is ever required.
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(createMock.mock.calls[0][0].data.questionSetSnapshot).toEqual(
      toStored(QUESTIONS)
    );
  });

  it("rejects a rating far above any question's range", async () => {
    // Review finding I-3: this comment previously described a
    // three-choice scenario the test body never sent (it uses the
    // standard 5-level W1). What this actually pins: a wildly
    // out-of-range rating like 9 is always rejected, regardless of which
    // question it's against. The per-question bound specifically (a
    // hardcoded max(5) vs one derived from that question's own choice
    // count) is what the two tests below this one discriminate.
    const { POST } = await import("@/app/api/submit/route");
    const res = await POST(
      submitRequest({ ...validBody, answers: { ...completeAnswers(), W1: 9 } }) as never
    );
    expect(res.status).toBe(400);
  });

  it("rejects a rating out of range for a question with a DIFFERENT choice count than the rest of the set (I1)", async () => {
    // tests/submitRoute.test.ts:184 ("rejects a rating above that
    // question's own choice count") sends W1: 9 against a 5-level W1,
    // which a hardcoded .max(5) would reject identically -- it proves
    // nothing about the per-question feature. This test uses a set where
    // W1 has been truncated to 3 levels: a rating of 4 is out of range
    // for THIS question specifically (though valid for a 5-level
    // question elsewhere in the set), and 3 is the top of ITS range.
    //
    // NOTE: this direction alone does NOT discriminate the zod bound at
    // app/api/submit/route.ts (`.max(q.levels.length)` vs a hardcoded
    // `.max(5)`) -- lib/scoring.ts's normalizeAnswer independently
    // throws on any rating above a question's own choiceCount, so
    // scoreAssessment's defense-in-depth catches this case even under
    // the reverted `.max(5)` mutation (verified: both assertions below
    // stayed green under that mutation). It is kept because it still
    // pins a real, load-bearing property -- an out-of-range answer for
    // a shrunk question is rejected end to end, by SOME layer -- but the
    // test that actually discriminates the zod bound specifically is
    // the one below ("accepts a rating that only a per-question... ").
    const truncated = QUESTIONS.map((q) =>
      q.id === "W1" ? { ...q, levels: q.levels.slice(0, 3) } : q
    );
    getPublishedQuestionsMock.mockResolvedValue({
      questions: truncated,
      version: 3,
    });
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const tooHigh = await POST(
      submitRequest({
        ...validBody,
        answers: { ...completeAnswers(), W1: 4 },
      }) as never
    );
    expect(tooHigh.status).toBe(400);

    const inRange = await POST(
      submitRequest({
        ...validBody,
        answers: { ...completeAnswers(), W1: 3 },
      }) as never
    );
    expect(inRange.status).toBe(200);
  });

  it("accepts a rating that only a per-question (not hardcoded-5) bound would allow", async () => {
    // The discriminating direction for I1: lib/scoring.ts's own
    // normalizeAnswer only ever REJECTS an out-of-range rating, so it
    // can mask a too-permissive route.ts bound (see the note in the
    // test above) but can never mask a too-RESTRICTIVE one. A question
    // with MORE than 5 levels (MAX_LEVELS = 7, lib/questionSet.ts) is
    // the case where a hardcoded `.max(5)` would wrongly 400 a rating
    // that is genuinely valid for that question -- only a bound derived
    // from that question's own levels.length lets it through.
    const expanded = QUESTIONS.map((q) =>
      q.id === "W1"
        ? withDerivedTiers([
            {
              id: q.id,
              gap: q.gap,
              statement: q.statement,
              levels: Array.from({ length: 7 }, (_, i) => ({
                value: i + 1,
                label: `W1 level ${i + 1}`,
                description: `W1 description ${i + 1}`,
              })),
            },
          ])[0]
        : q
    );
    getPublishedQuestionsMock.mockResolvedValue({
      questions: expanded,
      version: 3,
    });
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({
        ...validBody,
        answers: { ...completeAnswers(), W1: 7 },
      }) as never
    );

    expect(res.status).toBe(200);
  });
});

// CRITICAL CORRECTNESS: the version stamped on a submission must be the
// version the respondent actually answered, not whatever happens to be
// live the instant they hit submit -- an admin can publish a new version
// while someone is mid-assessment. app/page.tsx captures {questions,
// version} once at load; components/Assessment.tsx carries that version
// through untouched and sends it back as `questionSetVersion` on submit.
// The route must resolve that EXACT historical snapshot
// (getQuestionsForVersion) for both validation and scoring, and must NOT
// silently fall back to "whatever is live now" (getPublishedQuestions)
// when a version traveled with the request.
describe("POST /api/submit resolves the version that traveled with the request", () => {
  function withTruncatedW1(levelCount: number) {
    return QUESTIONS.map((q) =>
      q.id === "W1" ? { ...q, levels: q.levels.slice(0, levelCount) } : q
    );
  }

  it("scores against the version loaded at page-load time, not whatever is live at submit", async () => {
    // Simulate a publish landing mid-assessment: what's live NOW (version
    // 7) has trimmed W1 down to 3 choices. The respondent loaded version 3,
    // when W1 still had all 5, and answered 5 -- a rating that is only
    // valid under the version they actually saw.
    getPublishedQuestionsMock.mockResolvedValue({
      questions: withTruncatedW1(3),
      version: 7,
    });
    getQuestionsForVersionMock.mockImplementation(async (version: number | null) =>
      version === 3 ? QUESTIONS : null
    );
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({
        ...validBody,
        answers: { ...completeAnswers(), W1: 5 },
        questionSetVersion: 3,
      }) as never
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(createMock.mock.calls[0][0].data.questionSetVersion).toBe(3);
    // The proof this used version 3's (5-choice) question set rather than
    // the live 3-choice one: the "live" resolver was never even
    // consulted, and a run scored against the live set would have 400'd
    // on W1: 5.
    expect(getPublishedQuestionsMock).not.toHaveBeenCalled();
    expect(getQuestionsForVersionMock).toHaveBeenCalledWith(3);
  });

  it("resolves a null questionSetVersion (loaded before anything was ever published) without touching the live resolver", async () => {
    getQuestionsForVersionMock.mockImplementation(async (version: number | null) =>
      version === null ? QUESTIONS : null
    );
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({ ...validBody, questionSetVersion: null }) as never
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(createMock.mock.calls[0][0].data.questionSetVersion).toBeNull();
    expect(getPublishedQuestionsMock).not.toHaveBeenCalled();
  });

  it("falls back to the live published set only when the request carries no version at all", async () => {
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest(validBody) as never);

    expect(getPublishedQuestionsMock).toHaveBeenCalledTimes(1);
    expect(getQuestionsForVersionMock).not.toHaveBeenCalled();
  });

  it("retries getQuestionsForVersion once before giving up, and succeeds if the retry resolves", async () => {
    // getQuestionsForVersion swallows read errors into a null return
    // (its own try/catch in lib/questionContent.ts), so a single null is
    // potentially just a transient blip -- a connection-pool timeout, a
    // cold start. A bounded retry should recover a completed assessment
    // rather than discarding it on the first hiccup.
    getQuestionsForVersionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(QUESTIONS);
    createMock.mockResolvedValue({ id: "abc" });
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({ ...validBody, questionSetVersion: 5 }) as never
    );
    const json = await res.json();

    expect(getQuestionsForVersionMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(createMock.mock.calls[0][0].data.questionSetVersion).toBe(5);
  });

  it("does not write a row, but alerts staff with the raw answers, when the version still cannot be resolved after a retry", async () => {
    // Task 5 review C1: a version-resolution failure must never be
    // indistinguishable from silently discarding a completed assessment.
    // Nothing safe exists to score or snapshot against, so no row is
    // written -- but the answers must not simply vanish, mirroring the
    // remedy already used for a db.submission.create failure a few lines
    // below in the route: alert staff with the raw answers.
    getQuestionsForVersionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({ ...validBody, questionSetVersion: 99 }) as never
    );

    // Retried once, still null.
    expect(getQuestionsForVersionMock).toHaveBeenCalledTimes(2);

    // Nothing safe to score or snapshot against -- no row written.
    expect(createMock).not.toHaveBeenCalled();

    expect(alertMock).toHaveBeenCalledTimes(1);
    const details = alertMock.mock.calls[0][0];
    expect(details.prospectName).toBe("Jane Owner");
    expect(details.companyName).toBe("Acme Fabrication");
    expect(details.answers).toEqual(completeAnswers());
    // No score exists on this path -- result must be optional and absent
    // here, not fabricated.
    expect(details.result).toBeUndefined();

    // Not 409 (this isn't a request/state conflict) -- 503, the server's
    // own dependency could not be read even after a retry.
    expect(res.status).toBe(503);
  });

  it("does not alert staff when the request never looked like a genuine attempt (I-2)", async () => {
    // Review finding I-2: this whole branch runs BEFORE the zod parse
    // further down (which needs `questions`, unavailable on this path),
    // so a request with no real content -- here, no answers and no
    // names at all -- would otherwise still page staff with an "ACTION
    // NEEDED" alert about nothing, just because its (nonexistent)
    // version also failed to resolve. The alert firing is what's being
    // pinned here; the response status for this shape of request is not
    // this test's concern.
    getQuestionsForVersionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/submit/route");

    await POST(submitRequest({ questionSetVersion: 42 }) as never);

    expect(getQuestionsForVersionMock).toHaveBeenCalledTimes(2);
    expect(createMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does not alert staff when the requested version is fractional, since it could never match a real row (I-2)", async () => {
    // The other half of I-2: .int() at the zod schema further down never
    // runs on this path (that schema needs the resolved `questions`),
    // so a fractional version like 3.5 previously sailed straight
    // through to "could not resolve, alert staff" -- a malformed
    // request, not a transient read failure.
    getQuestionsForVersionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/submit/route");

    await POST(
      submitRequest({ ...validBody, questionSetVersion: 3.5 }) as never
    );

    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does not instruct the respondent to reload, since reloading would destroy their in-memory answers", async () => {
    getQuestionsForVersionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/submit/route");

    const res = await POST(
      submitRequest({ ...validBody, questionSetVersion: 99 }) as never
    );
    const json = await res.json();

    expect(json.error).not.toMatch(/reload/i);
  });
});
