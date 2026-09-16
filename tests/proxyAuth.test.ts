import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The gate itself. What matters here is not that a good session passes, but
// that each specific way of getting in without one is closed.

async function fresh() {
  vi.resetModules();
  return {
    ...(await import("@/proxy")),
    session: await import("@/lib/adminSession"),
  };
}

function request(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", `wave_admin=${cookie}`);
  return new NextRequest(`https://wave.example.com${path}`, { headers });
}

beforeEach(() => {
  process.env.ADMIN_USERS = "Alex:pass-alex-2026,Sam:pass-sam-8841";
  delete process.env.ADMIN_SESSION_SECRET;
});

describe("admin gate", () => {
  it("lets a valid session through", async () => {
    const { proxy, session } = await fresh();
    const token = await session.createSessionToken("Alex");
    const res = await proxy(request("/admin", token!));
    expect(res.status).toBe(200);
  });

  it("redirects a page request with no session", async () => {
    const { proxy } = await fresh();
    const res = await proxy(request("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/login");
  });

  it("401s an API request with no session", async () => {
    const { proxy } = await fresh();
    expect((await proxy(request("/api/admin/export"))).status).toBe(401);
  });

  it("refuses the passcode itself as a cookie", async () => {
    // The old cookie format. Someone holding an old cookie, or simply typing
    // the passcode into one, must not be admitted.
    const { proxy } = await fresh();
    expect((await proxy(request("/admin", "pass-alex-2026"))).status).toBe(307);
  });

  it("refuses an expired session", async () => {
    const { proxy, session } = await fresh();
    const stale = await session.createSessionToken(
      "Alex",
      Date.now() - session.SESSION_TTL_MS - 1000
    );
    expect((await proxy(request("/admin", stale!))).status).toBe(307);
  });

  it("locks out a user removed from ADMIN_USERS immediately", async () => {
    // Revocation must not wait for the token to expire.
    const { session } = await fresh();
    const token = await session.createSessionToken("Sam");

    process.env.ADMIN_USERS = "Alex:pass-alex-2026,Sam:pass-sam-8841";
    const still = await fresh();
    expect((await still.proxy(request("/admin", token!))).status).toBe(200);

    // Sam is removed. Note the signing key is derived from ADMIN_USERS, so
    // this is belt and braces -- the name check is what makes revocation work
    // when an explicit ADMIN_SESSION_SECRET is configured.
    process.env.ADMIN_SESSION_SECRET = "a-fixed-secret-that-does-not-change";
    const before = await fresh();
    const keptToken = await before.session.createSessionToken("Sam");
    expect((await before.proxy(request("/admin", keptToken!))).status).toBe(200);

    process.env.ADMIN_USERS = "Alex:pass-alex-2026";
    const after = await fresh();
    expect((await after.proxy(request("/admin", keptToken!))).status).toBe(307);
  });

  it("clears a dead cookie instead of letting it be re-sent forever", async () => {
    const { proxy } = await fresh();
    const res = await proxy(request("/admin", "garbage"));
    expect(res.cookies.get("wave_admin")?.value).toBe("");
  });

  it("leaves the public assessment open", async () => {
    const { proxy } = await fresh();
    expect((await proxy(request("/"))).status).toBe(200);
    expect((await proxy(request("/api/submit"))).status).toBe(200);
    expect((await proxy(request("/admin/login"))).status).toBe(200);
    expect((await proxy(request("/api/admin/login"))).status).toBe(200);
  });

  it("sends security headers on public pages, not just admin ones", async () => {
    // The assessment is the page strangers actually load.
    const { proxy } = await fresh();
    const res = await proxy(request("/"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(res.headers.get("Referrer-Policy")).toBeTruthy();
    expect(res.headers.get("Permissions-Policy")).toBeTruthy();
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("sends them on a rejection too, not only on success", async () => {
    const { proxy } = await fresh();
    expect(
      (await proxy(request("/api/admin/export"))).headers.get("X-Frame-Options")
    ).toBe("DENY");
  });
});
