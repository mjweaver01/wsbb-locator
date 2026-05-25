import { Hono } from "hono";
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
