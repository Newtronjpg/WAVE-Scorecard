import { describe, it, expect, beforeEach, vi } from "vitest";

// The cookie used to BE the passcode, with no server-side expiry at all.
// These pin the two properties that replaced it: a token cannot be forged or
// edited, and it stops working on its own.

async function fresh() {
  vi.resetModules();
  return import("@/lib/adminSession");
}

beforeEach(() => {
  process.env.ADMIN_USERS = "Alex:pass-alex-2026,Sam:pass-sam-8841";
  delete process.env.ADMIN_SESSION_SECRET;
});

describe("admin session tokens", () => {
  it("round-trips the staff member who logged in", async () => {
    const { createSessionToken, verifySessionToken } = await fresh();
    const token = await createSessionToken("Alex");
    expect(token).toBeTruthy();
    expect((await verifySessionToken(token!))?.name).toBe("Alex");
  });

  it("never contains the passcode", async () => {
    // The whole point. Whoever reads the cookie must not learn how to log in.
    const { createSessionToken } = await fresh();
    const token = await createSessionToken("Alex");
    expect(token).not.toContain("pass-alex-2026");
    const body = Buffer.from(
      token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString();
    expect(body).not.toContain("pass-alex-2026");
  });

  it("expires, and is refused the moment it does", async () => {
    const { createSessionToken, verifySessionToken, SESSION_TTL_MS } = await fresh();
    const now = Date.now();
    const token = await createSessionToken("Alex", now);

    expect(await verifySessionToken(token!, now + SESSION_TTL_MS - 1000)).not.toBeNull();
    expect(await verifySessionToken(token!, now + SESSION_TTL_MS)).toBeNull();
    expect(await verifySessionToken(token!, now + SESSION_TTL_MS + 86_400_000)).toBeNull();
  });

  it("refuses a token whose payload has been edited", async () => {
    // Swapping the name to another staff member, or pushing exp out, must not
    // survive -- the signature covers the payload.
    const { createSessionToken, verifySessionToken } = await fresh();
    const token = await createSessionToken("Alex");
    const [v, body, sig] = token!.split(".");

    const decoded = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    decoded.name = "Sam";
    decoded.exp = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    const forgedBody = Buffer.from(JSON.stringify(decoded))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifySessionToken(`${v}.${forgedBody}.${sig}`)).toBeNull();
  });

  it("refuses a token signed with a different secret", async () => {
    const { createSessionToken } = await fresh();
    const token = await createSessionToken("Alex");

    // Rotating a passcode changes the derived key, which logs everyone out.
    process.env.ADMIN_USERS = "Alex:a-new-passcode-entirely";
    const { verifySessionToken } = await fresh();
    expect(await verifySessionToken(token!)).toBeNull();
  });

  it("refuses garbage without throwing", async () => {
    const { verifySessionToken } = await fresh();
    for (const bad of [undefined, "", "not-a-token", "v1.only-two", "v2.a.b", "v1..", "v1.!!!.!!!"]) {
      expect(await verifySessionToken(bad as string | undefined)).toBeNull();
    }
  });

  it("refuses a self-declared lifetime longer than the policy", async () => {
    // Defence against a future bug or a leaked key: even a correctly signed
    // token cannot buy itself a longer session than the policy allows.
    const { verifySessionToken, SESSION_TTL_MS } = await fresh();
    const now = Date.now();
    const payload = { name: "Alex", iat: now, exp: now + SESSION_TTL_MS * 10 };
    const body = Buffer.from(JSON.stringify(payload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`wave-admin-session:${process.env.ADMIN_USERS}`)
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
    );
    const sig = Buffer.from(sigBytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifySessionToken(`v1.${body}.${sig}`)).toBeNull();
  });

  it("fails closed when nothing is configured", async () => {
    delete process.env.ADMIN_USERS;
    const { createSessionToken, verifySessionToken } = await fresh();
    expect(await createSessionToken("Alex")).toBeNull();
    expect(await verifySessionToken("v1.a.b")).toBeNull();
  });
});
