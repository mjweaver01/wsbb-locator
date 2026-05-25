import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  fetchCoachesFromThinkific,
  type Coach,
  type CoachesPayload,
} from "./lib/thinkific";
import { env } from "./lib/env";

const app = new Hono();
const PORT = env.port;
const CACHE_TTL_MS = env.coachCacheTtlMs;
const OVERRIDES_PATH = resolve(import.meta.dir, "../data/coach-overrides.json");

type CoachOverride = Partial<Omit<Coach, "thinkificUserId">>;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: CoachesPayload | null = null;
let cacheSetAt = 0;

function isCacheStale() {
  return !cache || Date.now() - cacheSetAt > CACHE_TTL_MS;
}

/** Load the static fallback JSON bundled with the web app. */
function loadStaticFallback(): CoachesPayload {
  const staticPath = resolve(import.meta.dir, "../data/coaches-raw.json");
  const raw = readFileSync(staticPath, "utf8");
  return JSON.parse(raw) as CoachesPayload;
}

/**
 * Optional local overrides keyed by Thinkific user ID.
 * Example:
 * {
 *   "1001": { "city": "Columbus", "bio": "Updated coach bio" }
 * }
 */
function loadCoachOverrides(): Record<string, CoachOverride> {
  if (!existsSync(OVERRIDES_PATH)) return {};

  try {
    const raw = readFileSync(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("coach-overrides.json must be an object keyed by Thinkific user ID");
    }
    return parsed as Record<string, CoachOverride>;
  } catch (err) {
    console.error("[overrides] failed to parse coach-overrides.json:", (err as Error).message);
    return {};
  }
}

function recalculateTierBreakdown(coaches: Coach[]): CoachesPayload["tierBreakdown"] {
  return {
    master: coaches.filter((c) => c.tier === "master").length,
    instructor: coaches.filter((c) => c.tier === "instructor").length,
    certified: coaches.filter((c) => c.tier === "certified").length,
  };
}

function mergeCoachOverrides(data: CoachesPayload): CoachesPayload {
  const overridesById = loadCoachOverrides();
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

async function getCoaches(): Promise<{ data: CoachesPayload; source: string }> {
  if (!isCacheStale()) {
    return { data: cache!, source: "cache" };
  }

  const hasThinkificCreds =
    env.thinkificApiKey && env.thinkificSubdomain;

  if (hasThinkificCreds) {
    try {
      console.log("[thinkific] fetching live data...");
      const data = mergeCoachOverrides(await fetchCoachesFromThinkific());
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
    const data = mergeCoachOverrides(loadStaticFallback());
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

/** Force a cache refresh (useful after running the seed script). */
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
