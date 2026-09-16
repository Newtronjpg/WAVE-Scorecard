import { createHash } from "node:crypto";
import { db } from "./db";

// Throttles the public submit endpoint -- unauthenticated, and every call
// writes a row and sends an email, so an unthrottled link is one script
// away from a full database and a flooded inbox.
//
// Fixed window, not sliding or token bucket: a single row, trivially
// testable, and the boundary-burst failure mode is irrelevant at these
// volumes. Stored in Postgres, not memory, since serverless instances
// don't share memory.

export const SUBMIT_MAX_PER_WINDOW = 10;
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000; // one hour

export interface WindowState {
  count: number;
  windowStart: Date;
}

export interface WindowDecision {
  allowed: boolean;
  nextCount: number;
  nextWindowStart: Date;
  retryAfterSeconds: number;
}

// Pure: given the stored state and the current time, decide. No database,
// no clock of its own, so every branch is directly testable.
export function evaluateWindow(
  existing: WindowState | null,
  now: Date,
  max: number,
  windowMs: number
): WindowDecision {
  const elapsed = existing ? now.getTime() - existing.windowStart.getTime() : Infinity;

  // A request landing exactly on the boundary belongs to the new window.
  if (!existing || elapsed >= windowMs) {
    return {
      allowed: true,
      nextCount: 1,
      nextWindowStart: now,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= max) {
    const remainingMs = windowMs - elapsed;
    return {
      allowed: false,
      // Deliberately not incremented: counting denied requests would add
      // write load during exactly the flood it is meant to shed.
      nextCount: existing.count,
      nextWindowStart: existing.windowStart,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  return {
    allowed: true,
    nextCount: existing.count + 1,
    nextWindowStart: existing.windowStart,
    retryAfterSeconds: 0,
  };
}

// Derives the throttling key from the request headers.
//
// Hashed rather than stored raw: this becomes a primary key in our
// database, and a hash means a leak of that table is not a list of every
// visitor's IP address. Truncated because collisions across a handful of
// keys are harmless here and shorter keys index better.
// Which header to trust, in order, and why the obvious one is last.
//
// `x-forwarded-for` is APPENDED to by each proxy, so on Vercel the chain is
// "<whatever the client sent>, <the real client IP>". Reading the FIRST entry
// -- the conventional "original client" position -- therefore reads a value
// the caller chose, and anyone can defeat every throttle in this app by
// sending a different X-Forwarded-For on each request. That is exactly how
// this function used to work.
//
// `x-vercel-forwarded-for` and `x-real-ip` are set by the platform and
// overwrite anything the client sent, so they are trustworthy. x-forwarded-for
// is kept only as a last resort for running behind something else, and then
// the LAST entry is taken, because that is the hop closest to us and the only
// one the caller could not have written.
export function clientIdentifier(headers: Headers): string {
  const chain = headers.get("x-forwarded-for")?.split(",") ?? [];
  const nearestHop = chain.length > 0 ? chain[chain.length - 1]?.trim() : "";

  const raw =
    headers.get("x-vercel-forwarded-for")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    nearestHop ||
    "unknown";

  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Applies the decision against stored state. Fails OPEN: if the rate
// limit store itself is unavailable, a real prospect must still be able
// to submit. Losing throttling is a far smaller harm than turning a
// database blip into a locked-out assessment.
export async function checkRateLimit(
  key: string,
  max: number = SUBMIT_MAX_PER_WINDOW,
  windowMs: number = SUBMIT_WINDOW_MS,
  // Fail-open is right for the public assessment and wrong for a login; the
  // caller decides. See the note on the catch block below.
  options: { failOpen?: boolean } = {}
): Promise<RateLimitResult> {
  const failOpen = options.failOpen ?? true;
  const now = new Date();

  try {
    const existing = await db.rateLimit.findUnique({ where: { key } });
    const decision = evaluateWindow(
      existing ? { count: existing.count, windowStart: existing.windowStart } : null,
      now,
      max,
      windowMs
    );

    if (decision.allowed) {
      await db.rateLimit.upsert({
        where: { key },
        create: {
          key,
          count: decision.nextCount,
          windowStart: decision.nextWindowStart,
        },
        update: {
          count: decision.nextCount,
          windowStart: decision.nextWindowStart,
        },
      });
    }

    return {
      allowed: decision.allowed,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  } catch (e) {
    // Fails OPEN by default: a database blip must not turn into a locked-out
    // assessment, and losing throttling on a public form is the smaller harm.
    //
    // Callers guarding a CREDENTIAL pass failOpen: false, because there the
    // trade reverses -- unlimited guessing while the store is down is far
    // worse than an unavailable login.
    if (failOpen) {
      console.error("Rate limit check failed, allowing the request:", e);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    console.error("Rate limit check failed, DENYING the request:", e);
    return { allowed: false, retryAfterSeconds: 60 };
  }
}
