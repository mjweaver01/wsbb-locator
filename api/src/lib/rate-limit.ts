/**
 * In-process sliding-window rate limiter. Not multi-instance safe — move to
 * Redis (or similar) before horizontal scaling. See README "Known Gaps".
 */

interface RateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

const store = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (store.get(key) ?? []).filter((ts) => ts >= cutoff);

  if (recent.length >= maxAttempts) {
    const oldest = recent[0] ?? now;
    store.set(key, recent);
    return {
      limited: true,
      retryAfterSeconds: Math.ceil(Math.max(0, oldest + windowMs - now) / 1000),
    };
  }

  recent.push(now);
  store.set(key, recent);
  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Periodically drop empty buckets so the map can't grow without bound from
 * one-off (IP, email) keys that never come back.
 */
export function startRateLimitSweeper(windowMs: number): () => void {
  const interval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, attempts] of store) {
      const surviving = attempts.filter((ts) => ts >= cutoff);
      if (surviving.length === 0) store.delete(key);
      else if (surviving.length !== attempts.length) store.set(key, surviving);
    }
  }, windowMs);
  // Don't keep the Bun process alive just for the sweeper.
  if (
    typeof interval === "object" &&
    interval !== null &&
    "unref" in interval
  ) {
    (interval as { unref: () => void }).unref();
  }
  return () => clearInterval(interval);
}
