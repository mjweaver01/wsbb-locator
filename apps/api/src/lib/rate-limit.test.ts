import { describe, expect, test } from "bun:test";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  test("limits after max attempts within the window", () => {
    const key = `rate-limit-${crypto.randomUUID()}`;
    const windowMs = 200;

    expect(checkRateLimit(key, 2, windowMs)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit(key, 2, windowMs)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });

    const limited = checkRateLimit(key, 2, windowMs);
    expect(limited.limited).toBe(true);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("allows requests again after the window expires", async () => {
    const key = `rate-limit-${crypto.randomUUID()}`;
    const windowMs = 75;

    expect(checkRateLimit(key, 1, windowMs).limited).toBe(false);
    expect(checkRateLimit(key, 1, windowMs).limited).toBe(true);

    await Bun.sleep(windowMs + 30);

    expect(checkRateLimit(key, 1, windowMs)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });

  test("tracks keys independently", () => {
    const blockedKey = `rate-limit-${crypto.randomUUID()}`;
    const freshKey = `rate-limit-${crypto.randomUUID()}`;
    const windowMs = 200;

    expect(checkRateLimit(blockedKey, 1, windowMs).limited).toBe(false);
    expect(checkRateLimit(blockedKey, 1, windowMs).limited).toBe(true);

    expect(checkRateLimit(freshKey, 1, windowMs)).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
  });
});
