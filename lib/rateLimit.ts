import { createHash } from "node:crypto";
import { db } from "./db";

// Throttles the public submit endpoint.
//
// /api/submit is unauthenticated and every call writes a row and sends an
// email, so an unthrottled public link is one script away from a full
// database and a flooded inbox.
//
// Fixed window rather than a sliding window or token bucket: the counter
// is a single row, the logic is trivially testable, and the failure mode
// of a fixed window (a burst straddling a boundary can briefly reach 2x
// the limit) is irrelevant at these volumes. It is stored in Postgres
// rather than memory because serverless instances do not share memory, so
// an in-process counter would be bypassed simply by hitting a different
// instance.

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
export function clientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const raw =
    // A proxy chain lists the original client first.
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
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
  windowMs: number = SUBMIT_WINDOW_MS
): Promise<RateLimitResult> {
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
    console.error("Rate limit check failed, allowing the request:", e);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
