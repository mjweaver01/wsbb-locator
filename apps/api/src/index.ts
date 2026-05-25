import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { resolve } from "path";
import {
  fetchCoachesFromThinkific,
  type Coach,
  type CoachesPayload,
} from "./lib/thinkific";
import { env } from "./lib/env";
import {
  deleteCoachOverride,
  listCoachOverrides,
  upsertCoachOverride,
  type CoachOverride,
} from "./lib/overrides-db";
import { loadThinkificCache, saveThinkificCache } from "./lib/thinkific-cache-db";
import {
  deleteCoachEmailLink,
  findThinkificUserIdByLinkedEmail,
  listCoachEmailLinks,
  upsertCoachEmailLink,
} from "./lib/email-links-db";
import {
  createCoachSession,
  createLoginCode,
  deleteCoachSession,
  getCoachSession,
  verifyAndConsumeLoginCode,
} from "./lib/auth-db";

const app = new Hono();
const PORT = env.port;
const CACHE_TTL_MS = env.coachCacheTtlMs;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: CoachesPayload | null = null;
let cacheSetAt = 0;

function isCacheStale() {
  return !cache || Date.now() - cacheSetAt > CACHE_TTL_MS;
}

/** Load the static fallback JSON bundled with the web app. */
function loadStaticFallback(): Promise<CoachesPayload> {
  const staticPath = resolve(import.meta.dir, "../data/coaches-raw.json");
  return Bun.file(staticPath).json() as Promise<CoachesPayload>;
}

function recalculateTierBreakdown(coaches: Coach[]): CoachesPayload["tierBreakdown"] {
  return {
    master: coaches.filter((c) => c.tier === "master").length,
    instructor: coaches.filter((c) => c.tier === "instructor").length,
    certified: coaches.filter((c) => c.tier === "certified").length,
  };
}

function mergeCoachOverrides(data: CoachesPayload): CoachesPayload {
  const overridesById = listCoachOverrides();
  const coaches = data.coaches.map((coach) => {
    const override = overridesById[String(coach.thinkificUserId)];
    return override ? { ...coach, ...override, thinkificUserId: coach.thinkificUserId } : coach;
  });

  return {
    ...data,
    coaches,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function buildSessionCookie(token: string, expiresAt: string): string {
  const encoded = encodeURIComponent(token);
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)
  );

  return [
    `${env.coachAuthCookieName}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function buildExpiredSessionCookie(): string {
  return [
    `${env.coachAuthCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

function getSessionTokenFromRequest(c: Context): string | null {
  const cookies = parseCookies(c.req.header("cookie"));
  return cookies[env.coachAuthCookieName] ?? null;
}

function getAuthenticatedThinkificUserId(c: Context): number | null {
  const token = getSessionTokenFromRequest(c);
  if (!token) return null;
  const session = getCoachSession(token);
  return session?.thinkificUserId ?? null;
}

async function resolveCoachByEmail(email: string): Promise<{
  thinkificUserId: number;
  source: "thinkific-email" | "linked-email";
}> {
  const normalizedEmail = normalizeEmail(email);
  const { data } = await getCoaches();

  const direct = data.coaches.find(
    (coach) => normalizeEmail(coach.email) === normalizedEmail
  );
  if (direct) {
    return { thinkificUserId: direct.thinkificUserId, source: "thinkific-email" };
  }

  const linkedId = findThinkificUserIdByLinkedEmail(normalizedEmail);
  if (linkedId) {
    return { thinkificUserId: linkedId, source: "linked-email" };
  }

  throw new Error("Coach not found");
}

async function getCoaches(): Promise<{ data: CoachesPayload; source: string }> {
  if (!isCacheStale()) {
    return { data: cache!, source: "cache" };
  }

  // DB-backed cache (primary durable source between re-syncs)
  try {
    const cached = loadThinkificCache();
    if (cached) {
      const data = mergeCoachOverrides(cached);
      cache = data;
      cacheSetAt = Date.now();
      console.log(`[db-cache] loaded ${data.totalCoaches} coaches from thinkific cache table`);
      return { data, source: "db-cache" };
    }
  } catch (err) {
    console.error("[db-cache] load failed, trying thinkific/static fallback:", (err as Error).message);
  }

  const hasThinkificCreds = env.thinkificApiKey && env.thinkificSubdomain;

  if (hasThinkificCreds) {
    try {
      console.log("[thinkific] db cache empty, fetching live data...");
      const thinkificData = await fetchCoachesFromThinkific();
      saveThinkificCache(thinkificData);
      const data = mergeCoachOverrides(thinkificData);
      cache = data;
      cacheSetAt = Date.now();
      console.log(`[thinkific] cached ${data.totalCoaches} coaches`);
      return { data, source: "thinkific" };
    } catch (err) {
      console.error("[thinkific] fetch failed, falling back to static JSON:", (err as Error).message);
    }
  }

  // Static fallback — demo mode
  try {
    const data = mergeCoachOverrides(await loadStaticFallback());
    cache = data;
    cacheSetAt = Date.now();
    console.log(`[static] loaded ${data.totalCoaches} coaches from coaches-raw.json`);
    return { data, source: "static" };
  } catch (err) {
    throw new Error(`No coach data available: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use("*", cors());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/coaches", async (c) => {
  try {
    const { data, source } = await getCoaches();
    return c.json(data, 200, { "X-Data-Source": source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

/** Force in-memory cache refresh from the configured source order. */
app.post("/api/coaches/refresh", async (c) => {
  cache = null;
  cacheSetAt = 0;
  try {
    const { data, source } = await getCoaches();
    return c.json({ refreshed: true, totalCoaches: data.totalCoaches, source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

/** Force a live Thinkific re-sync and rewrite DB cache tables. */
app.post("/api/coaches/resync", async (c) => {
  if (!env.thinkificApiKey || !env.thinkificSubdomain) {
    return c.json(
      { error: "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN are required for resync." },
      400
    );
  }

  try {
    const thinkificData = await fetchCoachesFromThinkific();
    saveThinkificCache(thinkificData);
    const data = mergeCoachOverrides(thinkificData);
    cache = data;
    cacheSetAt = Date.now();
    return c.json({
      resynced: true,
      source: "thinkific",
      totalCoaches: data.totalCoaches,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

/**
 * Request a one-time login code.
 * Always returns a generic success response to avoid leaking user existence.
 */
app.post("/api/coach-auth/request", async (c) => {
  let body: { email?: string };
  try {
    body = await c.req.json<{ email?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email) {
    return c.json({ error: "email is required" }, 400);
  }

  let debugCode: string | undefined;
  try {
    const resolved = await resolveCoachByEmail(email);
    const code = createLoginCode(
      resolved.thinkificUserId,
      email,
      env.coachAuthCodeTtlMinutes
    );

    // Placeholder delivery until provider wiring.
    console.log(
      `[coach-auth] code for ${email} (thinkificUserId=${resolved.thinkificUserId}, source=${resolved.source}): ${code}`
    );

    if (env.coachAuthDebugExposeCode) {
      debugCode = code;
    }
  } catch {
    // Intentionally ignored to prevent account enumeration.
  }

  return c.json({
    ok: true,
    message: "If this email is eligible, a login code has been sent.",
    ...(debugCode ? { debugCode } : {}),
  });
});

app.post("/api/coach-auth/verify", async (c) => {
  let body: { email?: string; code?: string };
  try {
    body = await c.req.json<{ email?: string; code?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !code) {
    return c.json({ error: "email and code are required" }, 400);
  }

  try {
    const resolved = await resolveCoachByEmail(email);
    const ok = verifyAndConsumeLoginCode(resolved.thinkificUserId, email, code);
    if (!ok) {
      return c.json({ error: "Invalid or expired code" }, 401);
    }

    const session = createCoachSession(
      resolved.thinkificUserId,
      env.coachSessionTtlDays
    );
    const { data } = await getCoaches();
    const coach = data.coaches.find(
      (item) => item.thinkificUserId === resolved.thinkificUserId
    );

    return c.json(
      {
        ok: true,
        coach: coach
          ? {
              thinkificUserId: coach.thinkificUserId,
              email: coach.email,
              fullName: coach.fullName,
              tier: coach.tier,
            }
          : { thinkificUserId: resolved.thinkificUserId },
      },
      200,
      { "Set-Cookie": buildSessionCookie(session.token, session.expiresAt) }
    );
  } catch {
    return c.json({ error: "Invalid or expired code" }, 401);
  }
});

app.post("/api/coach-auth/logout", (c) => {
  const token = getSessionTokenFromRequest(c);
  if (token) {
    deleteCoachSession(token);
  }

  return c.json(
    { ok: true },
    200,
    { "Set-Cookie": buildExpiredSessionCookie() }
  );
});

app.get("/api/coach-auth/me", async (c) => {
  const thinkificUserId = getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { data } = await getCoaches();
  const coach = data.coaches.find((item) => item.thinkificUserId === thinkificUserId);
  if (!coach) {
    return c.json({ error: "Coach not found" }, 404);
  }

  const emailLinks = listCoachEmailLinks(thinkificUserId);
  return c.json({
    coach,
    emailLinks,
  });
});

app.patch("/api/coach-auth/me", async (c) => {
  const thinkificUserId = getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: CoachOverride;
  try {
    body = await c.req.json<CoachOverride>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const patch: CoachOverride = {
    ...(typeof body.bio === "string" || body.bio === undefined ? { bio: body.bio } : {}),
    ...(typeof body.avatarUrl === "string" || body.avatarUrl === undefined
      ? { avatarUrl: body.avatarUrl }
      : {}),
    ...(typeof body.city === "string" || body.city === undefined ? { city: body.city } : {}),
    ...(typeof body.state === "string" || body.state === undefined ? { state: body.state } : {}),
    ...(typeof body.lat === "number" || body.lat === undefined ? { lat: body.lat } : {}),
    ...(typeof body.lng === "number" || body.lng === undefined ? { lng: body.lng } : {}),
  };

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No valid override fields provided" }, 400);
  }

  const saved = upsertCoachOverride(thinkificUserId, patch);
  cache = null;
  cacheSetAt = 0;

  return c.json({
    ok: true,
    thinkificUserId,
    override: saved,
  });
});

/**
 * Resolve coach identity by any known email.
 * Checks Thinkific primary email first, then linked aliases.
 */
app.get("/api/coaches/resolve-user", async (c) => {
  const email = c.req.query("email");
  if (!email) {
    return c.json({ error: "email query param is required" }, 400);
  }

  try {
    const resolved = await resolveCoachByEmail(email);
    return c.json({
      found: true,
      thinkificUserId: resolved.thinkificUserId,
      source: resolved.source,
    });
  } catch {
    return c.json({ found: false });
  }
});

app.get("/api/coaches/:thinkificUserId/email-links", (c) => {
  const thinkificUserId = Number(c.req.param("thinkificUserId"));
  if (!Number.isInteger(thinkificUserId)) {
    return c.json({ error: "thinkificUserId must be an integer" }, 400);
  }

  const links = listCoachEmailLinks(thinkificUserId);
  return c.json({ thinkificUserId, links });
});

app.put("/api/coaches/:thinkificUserId/email-links", async (c) => {
  const thinkificUserId = Number(c.req.param("thinkificUserId"));
  if (!Number.isInteger(thinkificUserId)) {
    return c.json({ error: "thinkificUserId must be an integer" }, 400);
  }

  let body: { email?: string; source?: string };
  try {
    body = await c.req.json<{ email?: string; source?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return c.json({ error: "email is required" }, 400);
  }

  const link = upsertCoachEmailLink(thinkificUserId, email, body.source);
  return c.json({ ok: true, link });
});

app.delete("/api/coaches/:thinkificUserId/email-links", async (c) => {
  const thinkificUserId = Number(c.req.param("thinkificUserId"));
  if (!Number.isInteger(thinkificUserId)) {
    return c.json({ error: "thinkificUserId must be an integer" }, 400);
  }

  let body: { email?: string };
  try {
    body = await c.req.json<{ email?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return c.json({ error: "email is required" }, 400);
  }

  const removed = deleteCoachEmailLink(thinkificUserId, email);
  return c.json({ ok: true, removed });
});

app.put("/api/coaches/:thinkificUserId/override", async (c) => {
  const thinkificUserId = Number(c.req.param("thinkificUserId"));
  if (!Number.isInteger(thinkificUserId)) {
    return c.json({ error: "thinkificUserId must be an integer" }, 400);
  }

  let body: CoachOverride;
  try {
    body = await c.req.json<CoachOverride>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const patch: CoachOverride = {
    ...(typeof body.bio === "string" || body.bio === undefined ? { bio: body.bio } : {}),
    ...(typeof body.avatarUrl === "string" || body.avatarUrl === undefined
      ? { avatarUrl: body.avatarUrl }
      : {}),
    ...(typeof body.city === "string" || body.city === undefined ? { city: body.city } : {}),
    ...(typeof body.state === "string" || body.state === undefined ? { state: body.state } : {}),
    ...(typeof body.lat === "number" || body.lat === undefined ? { lat: body.lat } : {}),
    ...(typeof body.lng === "number" || body.lng === undefined ? { lng: body.lng } : {}),
  };

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No valid override fields provided" }, 400);
  }

  upsertCoachOverride(thinkificUserId, patch);
  cache = null;
  cacheSetAt = 0;

  return c.json({ ok: true, thinkificUserId, override: patch });
});

app.delete("/api/coaches/:thinkificUserId/override", (c) => {
  const thinkificUserId = Number(c.req.param("thinkificUserId"));
  if (!Number.isInteger(thinkificUserId)) {
    return c.json({ error: "thinkificUserId must be an integer" }, 400);
  }

  deleteCoachOverride(thinkificUserId);
  cache = null;
  cacheSetAt = 0;
  return c.json({ ok: true, thinkificUserId });
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    cachedAt: cache ? new Date(cacheSetAt).toISOString() : null,
    totalCoaches: cache?.totalCoaches ?? 0,
  })
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log(`[api] starting on http://localhost:${PORT}`);

// Warm the cache in the background so the first request is instant
getCoaches().catch((err) =>
  console.error("[api] startup cache warm failed:", err.message)
);

export default { port: PORT, fetch: app.fetch };
