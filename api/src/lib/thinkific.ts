/**
 * Thinkific API client.
 *
 * Fetches completed pathway enrollments and user profiles, returning
 * a structured CoachesPayload ready to serve from the API.
 *
 * Env vars required:
 *   THINKIFIC_API_KEY    – from Thinkific Admin → Settings → API
 *   THINKIFIC_SUBDOMAIN  – e.g. "westside-barbell"
 *
 * Env vars optional (fill in after running `bun run fetch` once to see all courses):
 *   THINKIFIC_LEVEL1_ID  – course ID for Level 1 pathway
 *   THINKIFIC_LEVEL2_ID  – course ID for Level 2 pathway
 *   THINKIFIC_LEVEL3_ID  – course ID for Level 3 pathway
 */

import { env } from "./env";
import { geocodeCompany } from "./geocode";
import type {
  Coach,
  CoachesPayload,
  CoachTier,
  RawCertification,
} from "@shared/coach";
import { TIER_RANK } from "@shared/tiers";

const BASE_URL = "https://api.thinkific.com/api/public/v1";
const PAGE_LIMIT = 250;

export function recalculateTierBreakdown(
  coaches: Coach[],
): CoachesPayload["tierBreakdown"] {
  const breakdown = { master: 0, instructor: 0, certified: 0 };
  for (const coach of coaches) breakdown[coach.tier] += 1;
  return breakdown;
}

// ---------------------------------------------------------------------------
// Thinkific API wire types (internal to this client)
// ---------------------------------------------------------------------------

interface ThinkificUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  company: string | null;
}

interface ThinkificEnrollment {
  id: number;
  user_id: number;
  course_id: number;
  completed: boolean;
  completed_at: string | null;
  activated_at: string | null;
}

interface ThinkificCourse {
  id: number;
  name: string;
  slug: string;
}

interface ThinkificPagination {
  current_page: number;
  next_page: number | null;
  total_pages: number;
  total_count: number;
}

interface ThinkificListResponse<T> {
  items: T[];
  meta: { pagination: ThinkificPagination };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeHeaders(apiKey: string, subdomain: string) {
  return {
    // The API access token (type `api_access_token`) is a JWT and
    // authenticates via a Bearer header. The subdomain is encoded in the
    // token; we still send the header for parity.
    Authorization: `Bearer ${apiKey}`,
    "X-Auth-Subdomain": subdomain,
    "Content-Type": "application/json",
  };
}

async function thinkificGet<T>(
  path: string,
  headers: Record<string, string>,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Thinkific ${res.status} on ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllPages<T>(
  path: string,
  headers: Record<string, string>,
  extraParams: Record<string, string | number | boolean> = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await thinkificGet<ThinkificListResponse<T>>(path, headers, {
      ...extraParams,
      page,
      limit: PAGE_LIMIT,
    });
    results.push(...data.items);
    totalPages = data.meta.pagination.total_pages;
    page++;
    if (page <= totalPages) await sleep(env.thinkificRateLimitMs);
  } while (page <= totalPages);

  return results;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetches all certified coaches from Thinkific and returns a CoachesPayload.
 * Throws if THINKIFIC_API_KEY or THINKIFIC_SUBDOMAIN are not set.
 */
export async function fetchCoachesFromThinkific(): Promise<CoachesPayload> {
  const apiKey = env.thinkificApiKey;
  const subdomain = env.thinkificSubdomain;

  if (!apiKey || !subdomain) {
    throw new Error(
      "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN must be set to fetch live data.",
    );
  }

  const headers = makeHeaders(apiKey, subdomain);

  const pathwayCourses = [
    env.thinkificLevel1Id && {
      courseId: env.thinkificLevel1Id,
      level: 1,
      tier: "certified" as const,
    },
    env.thinkificLevel2Id && {
      courseId: env.thinkificLevel2Id,
      level: 2,
      tier: "instructor" as const,
    },
    env.thinkificLevel3Id && {
      courseId: env.thinkificLevel3Id,
      level: 3,
      tier: "master" as const,
    },
  ].filter(
    (course): course is { courseId: number; level: number; tier: CoachTier } =>
      Boolean(course),
  );

  if (pathwayCourses.length === 0) {
    // No course IDs configured — list all courses and throw so the caller can surface this
    const courses = await fetchAllPages<ThinkificCourse>("/courses", headers);
    const list = courses.map((c) => `  ${c.id}  ${c.name}`).join("\n");
    throw new Error(
      `No pathway course IDs configured. Set THINKIFIC_LEVEL1_ID / _LEVEL2_ID / _LEVEL3_ID.\n\nAvailable courses:\n${list}`,
    );
  }

  const userMap = new Map<
    number,
    { tier: CoachTier; certifications: RawCertification[] }
  >();

  for (const { courseId, level, tier } of pathwayCourses) {
    const enrollments = await fetchAllPages<ThinkificEnrollment>(
      "/enrollments",
      headers,
      { "query[course_id]": courseId, "query[completed]": true },
    );

    for (const enrollment of enrollments) {
      const cert: RawCertification = {
        level,
        courseId,
        completedAt: enrollment.completed_at ?? enrollment.activated_at,
      };
      const existing = userMap.get(enrollment.user_id);
      if (!existing) {
        userMap.set(enrollment.user_id, { tier, certifications: [cert] });
      } else {
        if (TIER_RANK[tier] > TIER_RANK[existing.tier]) existing.tier = tier;
        existing.certifications.push(cert);
      }
    }
  }

  const coaches: Coach[] = [];
  const userEntries = [...userMap.entries()];

  for (let i = 0; i < userEntries.length; i++) {
    const entry = userEntries[i];
    if (!entry) continue;
    const [userId, { tier, certifications }] = entry;
    try {
      const user = await thinkificGet<ThinkificUser>(
        `/users/${userId}`,
        headers,
      );
      coaches.push({
        thinkificUserId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        company: user.company || null,
        tier,
        certifications: certifications.sort((a, b) => a.level - b.level),
      });
    } catch {
      // Skip users we can't load
    }
    if (i < userEntries.length - 1) await sleep(env.thinkificRateLimitMs);
  }

  await resolveCoachLocations(coaches);

  return {
    fetchedAt: new Date().toISOString(),
    subdomain,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
    coaches,
  };
}

/**
 * Best-effort: derive a location for coaches that have a `company` but no
 * location yet, by geocoding the company name. Confidently-placed coaches get
 * city/state/lat/lng plus a `locationSource` marker; everyone else is left
 * untouched for a coach override to fill in. Mutates `coaches` in place.
 */
async function resolveCoachLocations(coaches: Coach[]): Promise<void> {
  if (!env.geocodeEnabled) return;

  let resolved = 0;
  for (const coach of coaches) {
    const hasLocation = coach.lat != null && coach.lng != null;
    if (!coach.company || hasLocation) continue;

    const geo = await geocodeCompany(coach.company);
    if (!geo) continue;

    coach.lat = geo.lat;
    coach.lng = geo.lng;
    if (geo.city) coach.city = geo.city;
    if (geo.state) coach.state = geo.state;
    coach.locationSource = "company-geocode";
    resolved += 1;
  }

  console.log(`[geocode] resolved ${resolved} coach location(s) from company`);
}
