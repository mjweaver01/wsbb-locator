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

const EMAIL = "Coach@Example.com";
let nextUserId = 999_001;

function allocateUserId(): number {
  const userId = nextUserId;
  nextUserId += 1;
  return userId;
}

describe("coach auth flow", () => {
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a fresh code verifies once and only once", async () => {
    const userId = allocateUserId();
    const code = await createLoginCode(userId, EMAIL, 15);

    expect(await verifyAndConsumeLoginCode(userId, EMAIL, code)).toBe(true);
    expect(await verifyAndConsumeLoginCode(userId, EMAIL, code)).toBe(false);
  });

  test("wrong code is rejected without consuming the valid one", async () => {
    const userId = allocateUserId();
    const code = await createLoginCode(userId, EMAIL, 15);

    expect(await verifyAndConsumeLoginCode(userId, EMAIL, "000000")).toBe(
      false,
    );
    expect(await verifyAndConsumeLoginCode(userId, EMAIL, code)).toBe(true);
  });

  test("code cannot be consumed by a different user id", async () => {
    const ownerId = allocateUserId();
    const attackerId = allocateUserId();
    const code = await createLoginCode(ownerId, EMAIL, 15);

    expect(await verifyAndConsumeLoginCode(attackerId, EMAIL, code)).toBe(
      false,
    );
    expect(await verifyAndConsumeLoginCode(ownerId, EMAIL, code)).toBe(true);
  });

  test("expired code is rejected", async () => {
    const userId = allocateUserId();
    const code = await createLoginCode(userId, EMAIL, -1);
    expect(await verifyAndConsumeLoginCode(userId, EMAIL, code)).toBe(false);
  });

  test("email lookup is case- and whitespace-insensitive", async () => {
    const userId = allocateUserId();
    const code = await createLoginCode(userId, "lowercase@example.com", 15);
    expect(
      await verifyAndConsumeLoginCode(
        userId,
        "  LowerCase@Example.com  ",
        code,
      ),
    ).toBe(true);
  });

  test("submitted code is whitespace-trimmed before verification", async () => {
    const userId = allocateUserId();
    const code = await createLoginCode(userId, EMAIL, 15);
    expect(await verifyAndConsumeLoginCode(userId, EMAIL, `  ${code}\n`)).toBe(
      true,
    );
  });

  test("session lifecycle: create → fetch → delete", async () => {
    const userId = allocateUserId();
    const { token, expiresAt } = await createCoachSession(userId, 30);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const session = await getCoachSession(token);
    expect(session?.thinkificUserId).toBe(userId);

    await deleteCoachSession(token);
    expect(await getCoachSession(token)).toBeNull();
  });

  test("expired session token is rejected", async () => {
    const userId = allocateUserId();
    const { token } = await createCoachSession(userId, -1);
    expect(await getCoachSession(token)).toBeNull();
  });

  test("unknown session token is null", async () => {
    expect(await getCoachSession("not-a-real-token")).toBeNull();
  });
});
