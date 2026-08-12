import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_ADMIN_USERS = process.env.ADMIN_USERS;

async function freshAdminAuth() {
  // adminAuth reads process.env.ADMIN_USERS inside each function call (not
  // at module load time), so re-importing isn't required between tests,
  // but resetVitestModules keeps this robust even if that ever changes.
  return await import("@/lib/adminAuth");
}

describe("matchAdminUser", () => {
  afterEach(() => {
    if (ORIGINAL_ADMIN_USERS === undefined) {
      delete process.env.ADMIN_USERS;
    } else {
      process.env.ADMIN_USERS = ORIGINAL_ADMIN_USERS;
    }
  });

  it("returns null when ADMIN_USERS is not set (fail closed)", async () => {
    delete process.env.ADMIN_USERS;
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("anything")).toBeNull();
  });

  it("returns null for a passcode that matches no one", async () => {
    process.env.ADMIN_USERS = "Ben:fw-ben-2026,Sarah:fw-sarah-8841";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("not-a-real-passcode")).toBeNull();
  });

  it("resolves the correct name for each configured passcode", async () => {
    process.env.ADMIN_USERS = "Ben:fw-ben-2026,Sarah:fw-sarah-8841";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("fw-ben-2026")).toEqual({ name: "Ben" });
    expect(matchAdminUser("fw-sarah-8841")).toEqual({ name: "Sarah" });
  });

  it("is case-sensitive and exact, not a partial match", async () => {
    process.env.ADMIN_USERS = "Ben:fw-ben-2026";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("fw-ben-2026 ")).toBeNull();
    expect(matchAdminUser("FW-BEN-2026")).toBeNull();
    expect(matchAdminUser("fw-ben-202")).toBeNull();
  });

  it("ignores malformed entries instead of crashing", async () => {
    // "NoColon" has no ":" separator, "Empty:" has no passcode,
    // ":OnlyPasscode" has no name. All three should be silently skipped,
    // leaving only the one well-formed entry usable.
    process.env.ADMIN_USERS = "NoColon,Empty:,:OnlyPasscode,Ben:fw-ben-2026";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("fw-ben-2026")).toEqual({ name: "Ben" });
    expect(matchAdminUser("")).toBeNull();
  });

  it("supports more than two staff", async () => {
    process.env.ADMIN_USERS =
      "Ben:fw-ben-2026,Sarah:fw-sarah-8841,Marcus:fw-marcus-1207,Priya:fw-priya-6630";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("fw-marcus-1207")).toEqual({ name: "Marcus" });
    expect(matchAdminUser("fw-priya-6630")).toEqual({ name: "Priya" });
  });
});

describe("isValidPasscode", () => {
  beforeEach(() => {
    process.env.ADMIN_USERS = "Ben:fw-ben-2026";
  });
  afterEach(() => {
    if (ORIGINAL_ADMIN_USERS === undefined) {
      delete process.env.ADMIN_USERS;
    } else {
      process.env.ADMIN_USERS = ORIGINAL_ADMIN_USERS;
    }
  });

  it("is true for any configured passcode regardless of whose it is", async () => {
    const { isValidPasscode } = await freshAdminAuth();
    expect(isValidPasscode("fw-ben-2026")).toBe(true);
  });

  it("is false for an unconfigured passcode", async () => {
    const { isValidPasscode } = await freshAdminAuth();
    expect(isValidPasscode("guess")).toBe(false);
  });
});
