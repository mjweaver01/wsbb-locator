import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fetchCoachesFromThinkific, type CoachesPayload } from "./lib/thinkific";

const app = new Hono();
const PORT = Number(process.env.PORT ?? 3001);
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
  const staticPath = resolve(
    import.meta.dir,
    "../../web/public/coaches-raw.json"
  );
  const raw = readFileSync(staticPath, "utf8");
  return JSON.parse(raw) as CoachesPayload;
}

async function getCoaches(): Promise<{ data: CoachesPayload; source: string }> {
  if (!isCacheStale()) {
    return { data: cache!, source: "cache" };
  }

  const hasThinkificCreds =
    process.env.THINKIFIC_API_KEY && process.env.THINKIFIC_SUBDOMAIN;

  if (hasThinkificCreds) {
    try {
      console.log("[thinkific] fetching live data...");
      const data = await fetchCoachesFromThinkific();
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
    const data = loadStaticFallback();
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
