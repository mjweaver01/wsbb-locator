import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Point the API at an isolated sqlite file before any module that imports
// `./db` (which opens the connection at import time) loads.
const tmpDir = mkdtempSync(join(tmpdir(), "wsbb-auth-test-"));
process.env.COACH_DATA_DB_PATH = join(tmpDir, "auth-test.sqlite");

const {
  createCoachSession,
  createLoginCode,
  deleteCoachSession,
  getCoachSession,
  verifyAndConsumeLoginCode,
} = await import("./auth");

const USER_ID = 999_001;
const EMAIL = "Coach@Example.com";

describe("coach auth flow", () => {
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a fresh code verifies once and only once", () => {
    const code = createLoginCode(USER_ID, EMAIL, 15);

    expect(verifyAndConsumeLoginCode(USER_ID, EMAIL, code)).toBe(true);
    expect(verifyAndConsumeLoginCode(USER_ID, EMAIL, code)).toBe(false);
  });

  test("wrong code is rejected without consuming the valid one", () => {
    const code = createLoginCode(USER_ID, EMAIL, 15);

    expect(verifyAndConsumeLoginCode(USER_ID, EMAIL, "000000")).toBe(false);
    expect(verifyAndConsumeLoginCode(USER_ID, EMAIL, code)).toBe(true);
  });

  test("expired code is rejected", () => {
    const code = createLoginCode(USER_ID, EMAIL, -1);
    expect(verifyAndConsumeLoginCode(USER_ID, EMAIL, code)).toBe(false);
  });

  test("email lookup is case- and whitespace-insensitive", () => {
    const code = createLoginCode(USER_ID, "lowercase@example.com", 15);
    expect(
      verifyAndConsumeLoginCode(USER_ID, "  LowerCase@Example.com  ", code),
    ).toBe(true);
  });

  test("session lifecycle: create → fetch → delete", () => {
    const { token, expiresAt } = createCoachSession(USER_ID, 30);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const session = getCoachSession(token);
    expect(session?.thinkificUserId).toBe(USER_ID);

    deleteCoachSession(token);
    expect(getCoachSession(token)).toBeNull();
  });

  test("unknown session token is null", () => {
    expect(getCoachSession("not-a-real-token")).toBeNull();
  });
});
