import { resolve } from "path";
import {
  fetchCoachesFromThinkific,
  recalculateTierBreakdown,
  type Coach,
  type CoachesPayload,
} from "./thinkific";
import { env } from "./env";
import { listCoachOverrides, type CoachOverride } from "./db/overrides";
import {
  loadThinkificCache,
  saveThinkificCache,
} from "./db/thinkific-cache";

export const STATIC_FALLBACK_PATH = resolve(
  import.meta.dir,
  "../../data/coaches-raw.json",
);

const SAFE_OVERRIDE_KEYS = [
  "bio",
  "avatarUrl",
  "city",
  "state",
  "lat",
  "lng",
] as const satisfies readonly (keyof CoachOverride)[];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: CoachesPayload | null = null;
let cacheSetAt = 0;

function readFreshCache(): CoachesPayload | null {
  const snapshot = cache;
  if (!snapshot) return null;
  if (Date.now() - cacheSetAt > env.coachCacheTtlMs) return null;
  return snapshot;
}

function writeCache(data: CoachesPayload): void {
  cache = data;
  cacheSetAt = Date.now();
}

export function invalidateCache(): void {
  cache = null;
  cacheSetAt = 0;
}

export function getCacheStatus(): {
  cachedAt: string | null;
  totalCoaches: number;
} {
  return {
    cachedAt: cache ? new Date(cacheSetAt).toISOString() : null,
    totalCoaches: cache?.totalCoaches ?? 0,
  };
}

function loadStaticFallback(): Promise<CoachesPayload> {
  return Bun.file(STATIC_FALLBACK_PATH).json() as Promise<CoachesPayload>;
}

/**
 * Apply local overrides to Thinkific data. Only fields in SAFE_OVERRIDE_KEYS
 * are merged in — identity columns (id/email/name/tier/certifications) always
 * come from Thinkific, even if a malformed override row contains them.
 *
 * `overrides` defaults to the persisted override map; callers (and tests) can
 * inject one to merge against a known set without hitting the DB.
 */
export async function mergeCoachOverrides(
  data: CoachesPayload,
  overrides?: Record<string, CoachOverride>,
): Promise<CoachesPayload> {
  const overridesById = overrides ?? (await listCoachOverrides());
  const coaches = data.coaches.map((coach) => {
    const override = overridesById[String(coach.thinkificUserId)];
    if (!override) return coach;
    const merged: Coach = { ...coach };
    for (const key of SAFE_OVERRIDE_KEYS) {
      const value = override[key];
      if (value !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  });

  return {
    ...data,
    coaches,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
  };
}

/**
 * Resolution order: in-memory cache → sqlite/pg cache → live Thinkific →
 * static JSON fallback. `source` is exposed via the `X-Data-Source` header
 * so ops can see which layer answered.
 */
export async function getCoaches(): Promise<{
  data: CoachesPayload;
  source: string;
}> {
  const fresh = readFreshCache();
  if (fresh) {
    return { data: fresh, source: "cache" };
  }

  try {
    const cached = await loadThinkificCache();
    if (cached) {
      const data = await mergeCoachOverrides(cached);
      writeCache(data);
      console.log(
        `[db-cache] loaded ${data.totalCoaches} coaches from thinkific cache table`,
      );
      return { data, source: "db-cache" };
    }
  } catch (err) {
    console.error(
      "[db-cache] load failed, trying thinkific/static fallback:",
      (err as Error).message,
    );
  }

  const hasThinkificCreds = env.thinkificApiKey && env.thinkificSubdomain;

  if (hasThinkificCreds) {
    try {
      console.log("[thinkific] db cache empty, fetching live data...");
      const thinkificData = await fetchCoachesFromThinkific();
      await saveThinkificCache(thinkificData);
      const data = await mergeCoachOverrides(thinkificData);
      writeCache(data);
      console.log(`[thinkific] cached ${data.totalCoaches} coaches`);
      return { data, source: "thinkific" };
    } catch (err) {
      console.error(
        "[thinkific] fetch failed, falling back to static JSON:",
        (err as Error).message,
      );
    }
  }

  try {
    const data = await mergeCoachOverrides(await loadStaticFallback());
    writeCache(data);
    console.log(
      `[static] loaded ${data.totalCoaches} coaches from coaches-raw.json`,
    );
    return { data, source: "static" };
  } catch (err) {
    throw new Error(`No coach data available: ${(err as Error).message}`);
  }
}

/**
 * Force a live Thinkific fetch, persist to the db cache, and seed the
 * in-memory cache. Used by the admin /resync endpoint to bypass every
 * layer above Thinkific.
 */
export async function resyncFromThinkific(): Promise<CoachesPayload> {
  const thinkificData = await fetchCoachesFromThinkific();
  await saveThinkificCache(thinkificData);
  const data = await mergeCoachOverrides(thinkificData);
  writeCache(data);
  return data;
}
