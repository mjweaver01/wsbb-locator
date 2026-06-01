import { timingSafeEqual } from "crypto";
import type { Context, Next } from "hono";
import { env } from "./env";

function getAdminApiKeyFromRequest(c: Context): string | null {
  const bearer = c.req.header("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }
  const headerKey = c.req.header("x-admin-api-key");
  return headerKey?.trim() || null;
}

// Constant-time string compare so the admin key check can't be probed
// byte-by-byte via response-timing. Bail before timingSafeEqual when lengths
// differ (it throws on mismatched buffer lengths) — but compare against the
// expected key's own length so the early return doesn't itself leak length.
function safeKeyEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    // Still run a comparison against expected to keep timing uniform.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function requireAdminApiKey(c: Context, next: Next) {
  if (!env.coachAdminApiKey) {
    return c.json(
      { error: "Admin API key is not configured on this server." },
      503,
    );
  }

  const provided = getAdminApiKeyFromRequest(c);
  if (!provided || !safeKeyEqual(provided, env.coachAdminApiKey)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
