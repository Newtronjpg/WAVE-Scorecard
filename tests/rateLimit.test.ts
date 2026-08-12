import { describe, it, expect } from "vitest";
import { clientIdentifier, evaluateWindow } from "@/lib/rateLimit";

// /api/submit is a public, unauthenticated endpoint that writes a row and
// sends an email. Once the link is public, one script can fill the
// database and the inbox. These tests pin the fixed-window logic and the
// identifier derivation; the storage around them is a thin wrapper.

const WINDOW = 60 * 60 * 1000; // one hour
const MAX = 10;

function at(ms: number) {
  return new Date(ms);
}

describe("evaluateWindow", () => {
  it("allows a first request and opens a window", () => {
    const result = evaluateWindow(null, at(1000), MAX, WINDOW);
    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(1);
    expect(result.nextWindowStart.getTime()).toBe(1000);
  });

  it("allows and increments while under the limit", () => {
    const result = evaluateWindow(
      { count: 3, windowStart: at(1000) },
      at(2000),
      MAX,
      WINDOW
    );
    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(4);
  });

  it("allows the request that reaches exactly the limit", () => {
    const result = evaluateWindow(
      { count: MAX - 1, windowStart: at(1000) },
      at(2000),
      MAX,
      WINDOW
    );
    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(MAX);
  });

  it("denies the request after the limit is reached", () => {
    const result = evaluateWindow(
      { count: MAX, windowStart: at(1000) },
      at(2000),
      MAX,
      WINDOW
    );
    expect(result.allowed).toBe(false);
  });

  it("does not increment the count on a denied request", () => {
    // Otherwise a sustained flood would keep pushing the number up
    // forever, which is pointless write load.
    const result = evaluateWindow(
      { count: MAX, windowStart: at(1000) },
      at(2000),
      MAX,
      WINDOW
    );
    expect(result.nextCount).toBe(MAX);
  });

  it("reports how long to wait, rounded up to whole seconds", () => {
    const result = evaluateWindow(
      { count: MAX, windowStart: at(0) },
      at(WINDOW - 1500),
      MAX,
      WINDOW
    );
    expect(result.retryAfterSeconds).toBe(2);
  });

  it("never reports a wait of less than one second", () => {
    const result = evaluateWindow(
      { count: MAX, windowStart: at(0) },
      at(WINDOW - 10),
      MAX,
      WINDOW
    );
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("starts a fresh window once the old one has expired", () => {
    const result = evaluateWindow(
      { count: MAX, windowStart: at(0) },
      at(WINDOW + 1),
      MAX,
      WINDOW
    );
    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(1);
    expect(result.nextWindowStart.getTime()).toBe(WINDOW + 1);
  });

  it("treats a request exactly at the window boundary as a new window", () => {
    const result = evaluateWindow(
      { count: MAX, windowStart: at(0) },
      at(WINDOW),
      MAX,
      WINDOW
    );
    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(1);
  });
});

describe("clientIdentifier", () => {
  it("derives a stable identifier from the forwarded client address", () => {
    const a = clientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5" }));
    const b = clientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5" }));
    expect(a).toBe(b);
  });

  it("gives different identifiers to different addresses", () => {
    const a = clientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5" }));
    const b = clientIdentifier(new Headers({ "x-forwarded-for": "198.51.100.9" }));
    expect(a).not.toBe(b);
  });

  it("uses only the first address when a proxy chain is present", () => {
    const direct = clientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5" }));
    const chained = clientIdentifier(
      new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" })
    );
    expect(chained).toBe(direct);
  });

  it("does not store the raw address", () => {
    // The identifier is a key in our database. Hashing means a leak of
    // that table does not hand over a list of visitors' IP addresses.
    const id = clientIdentifier(new Headers({ "x-forwarded-for": "203.0.113.5" }));
    expect(id).not.toContain("203.0.113.5");
  });

  it("falls back to x-real-ip when there is no forwarded header", () => {
    const viaReal = clientIdentifier(new Headers({ "x-real-ip": "203.0.113.5" }));
    const viaForwarded = clientIdentifier(
      new Headers({ "x-forwarded-for": "203.0.113.5" })
    );
    expect(viaReal).toBe(viaForwarded);
  });

  it("returns a usable identifier when no address header is present", () => {
    const id = clientIdentifier(new Headers({}));
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
