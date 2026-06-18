import { resolve } from "path";
import type { Coach, CoachesPayload } from "@shared/coach";
import {
  fetchCoachesFromThinkific,
  recalculateTierBreakdown,
} from "./thinkific";
import { deriveTier } from "@shared/tiers";
import { env } from "./env";
import { listCoachOverrides, type CoachOverride } from "./db/overrides";
import { listManualCoaches } from "./db/manual-coaches";
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

async function loadStaticFallback(): Promise<CoachesPayload> {
  const payload = (await Bun.file(
    STATIC_FALLBACK_PATH,
  ).json()) as CoachesPayload;
  // The snapshot's baked tiers may predate the current pathway rules, so
  // re-derive each coach's earned tier from their certifications. Master is
  // applied afterwards from admin grants in mergeCoachOverrides.
  const coaches = payload.coaches.map((coach) => ({
    ...coach,
    tier: deriveTier(coach.certifications),
  }));
  return {
    ...payload,
    coaches,
    tierBreakdown: recalculateTierBreakdown(coaches),
  };
}

/**
 * Apply local overrides to Thinkific data. Only fields in SAFE_OVERRIDE_KEYS
 * are merged in — identity columns (id/email/name/certifications) always come
 * from Thinkific, even if a malformed override row contains them.
 *
 * The one exception is `tier`: an admin `isMaster` grant promotes the coach to
 * Master Instructor here. Master is honorary and never earned from courses, so
 * it lives as a local grant layered over the Thinkific-derived tier.
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
    if (override.isFounder) merged.tier = "founder";
    else if (override.isMaster) merged.tier = "master";
    else if (override.isInstructor) merged.tier = "instructor";
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
 * Append manually-added ("house") coaches that don't originate from Thinkific
 * (see `db/manual-coaches.ts`) and recompute the totals. Manual coaches carry
 * their own identity/tier/location, so they're added as-is after the Thinkific
 * override merge.
 */
async function appendManualCoaches(
  data: CoachesPayload,
): Promise<CoachesPayload> {
  const manual = await listManualCoaches();
  if (manual.length === 0) return data;
  const coaches = [...data.coaches, ...manual];
  return {
    ...data,
    coaches,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
  };
}

/** Merge local overrides and append manual coaches into a served payload. */
async function buildServedPayload(
  base: CoachesPayload,
): Promise<CoachesPayload> {
  return mergeCoachOverrides(await appendManualCoaches(base));
}

/**
 * Read path — never calls Thinkific. Resolution order:
 *   in-memory cache → sqlite/pg DB cache → static JSON seed.
 *
 * Thinkific is only ever contacted by an explicit write trigger (admin
 * `resyncFromThinkific`, or a future Thinkific webhook), which populates the
 * DB cache that this function reads. `source` is exposed via the
 * `X-Data-Source` header so ops can see which layer answered.
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
      const data = await buildServedPayload(cached);
      writeCache(data);
      console.log(
        `[db-cache] loaded ${data.totalCoaches} coaches from thinkific cache table`,
      );
      return { data, source: "db-cache" };
    }
  } catch (err) {
    console.error(
      "[db-cache] load failed, falling back to static JSON seed:",
      (err as Error).message,
    );
  }

  try {
    const data = await buildServedPayload(await loadStaticFallback());
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
 * Force a live Thinkific fetch, persist to the DB cache, and seed the
 * in-memory cache. This is the only read-time path that contacts Thinkific,
 * and it's invoked exclusively by explicit write triggers (admin /resync,
 * future webhook) — never as an automatic fallback.
 */
export async function resyncFromThinkific(): Promise<CoachesPayload> {
  const thinkificData = await fetchCoachesFromThinkific();
  await saveThinkificCache(thinkificData);
  const data = await buildServedPayload(thinkificData);
  writeCache(data);
  return data;
}

// A full Thinkific fetch can outlast an HTTP request timeout (e.g. Railway's
// edge returns 502 before it finishes), so the admin endpoint kicks the resync
// off in the background and returns immediately. The single-flight guard keeps
// a double-click from running two overlapping fetches.
let resyncInFlight = false;

export function isResyncInFlight(): boolean {
  return resyncInFlight;
}

/**
 * Start a resync in the background if one isn't already running. Returns whether
 * a new run was started. Completion/failure is logged; the in-memory + DB cache
 * update when it finishes.
 */
export function startBackgroundResync(): boolean {
  if (resyncInFlight) return false;
  resyncInFlight = true;
  void resyncFromThinkific()
    .then((data) =>
      console.log(
        `[resync] completed: ${data.totalCoaches} coaches ${JSON.stringify(data.tierBreakdown)}`,
      ),
    )
    .catch((err) =>
      console.error("[resync] failed:", (err as Error).message),
    )
    .finally(() => {
      resyncInFlight = false;
    });
  return true;
}
