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
    process.env.ADMIN_USERS = "Alex:pass-alex-2026,Sam:pass-sam-8841";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("not-a-real-passcode")).toBeNull();
  });

  it("resolves the correct name for each configured passcode", async () => {
    process.env.ADMIN_USERS = "Alex:pass-alex-2026,Sam:pass-sam-8841";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-alex-2026")).toEqual({ name: "Alex" });
    expect(matchAdminUser("pass-sam-8841")).toEqual({ name: "Sam" });
  });

  it("is case-sensitive and exact, not a partial match", async () => {
    process.env.ADMIN_USERS = "Alex:pass-alex-2026";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-alex-2026 ")).toBeNull();
    expect(matchAdminUser("PASS-ALEX-2026")).toBeNull();
    expect(matchAdminUser("pass-alex-202")).toBeNull();
  });

  it("ignores malformed entries instead of crashing", async () => {
    // "NoColon" has no ":" separator, "Empty:" has no passcode,
    // ":OnlyPasscode" has no name. All three should be silently skipped,
    // leaving only the one well-formed entry usable.
    process.env.ADMIN_USERS = "NoColon,Empty:,:OnlyPasscode,Alex:pass-alex-2026";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-alex-2026")).toEqual({ name: "Alex" });
    expect(matchAdminUser("")).toBeNull();
  });

  it("supports more than two staff", async () => {
    process.env.ADMIN_USERS =
      "Alex:pass-alex-2026,Sam:pass-sam-8841,Marcus:pass-marcus-1207,Priya:pass-priya-6630";
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-marcus-1207")).toEqual({ name: "Marcus" });
    expect(matchAdminUser("pass-priya-6630")).toEqual({ name: "Priya" });
  });

  it("tolerates the whole value being wrapped in quotes (a common dashboard paste)", async () => {
    // Pasting `"Alex:pass-alex-2026"` verbatim from an .env example into a
    // hosting dashboard stores the quotes literally. The clean passcode
    // must still match.
    process.env.ADMIN_USERS = '"Alex:pass-alex-2026"';
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-alex-2026")).toEqual({ name: "Alex" });
  });

  it("tolerates quotes around each entry and stray whitespace", async () => {
    process.env.ADMIN_USERS = ' "Alex:pass-alex-2026" ,  Sam: pass-sam-8841 ';
    const { matchAdminUser } = await freshAdminAuth();
    expect(matchAdminUser("pass-alex-2026")).toEqual({ name: "Alex" });
    expect(matchAdminUser("pass-sam-8841")).toEqual({ name: "Sam" });
  });
});

describe("isValidPasscode", () => {
  beforeEach(() => {
    process.env.ADMIN_USERS = "Alex:pass-alex-2026";
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
    expect(isValidPasscode("pass-alex-2026")).toBe(true);
  });

  it("is false for an unconfigured passcode", async () => {
    const { isValidPasscode } = await freshAdminAuth();
    expect(isValidPasscode("guess")).toBe(false);
  });
});
