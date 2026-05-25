/**
 * Thinkific API client.
 *
 * Fetches completed pathway enrollments and user profiles, returning
 * a structured CoachesPayload ready to serve from the API.
 *
 * Env vars required:
 *   THINKIFIC_API_KEY    – from Thinkific Admin → Settings → API
 *   THINKIFIC_SUBDOMAIN  – e.g. "westsidebarbell"
 *
 * Env vars optional (fill in after running `bun run fetch` once to see all courses):
 *   THINKIFIC_LEVEL1_ID  – course ID for Level 1 pathway
 *   THINKIFIC_LEVEL2_ID  – course ID for Level 2 pathway
 *   THINKIFIC_LEVEL3_ID  – course ID for Level 3 pathway
 */

import { env } from "./env";

const BASE_URL = "https://api.thinkific.com/api/public/v1";
const PAGE_LIMIT = 250;
const RATE_LIMIT_MS = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachTier = "certified" | "instructor" | "master";

export interface RawCertification {
  level: number;
  courseId: number;
  completedAt: string | null;
}

export interface Coach {
  thinkificUserId: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  tier: CoachTier;
  certifications: RawCertification[];
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

export interface CoachesPayload {
  fetchedAt: string;
  subdomain: string;
  totalCoaches: number;
  tierBreakdown: { master: number; instructor: number; certified: number };
  coaches: Coach[];
}

interface ThinkificUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
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
    "X-Auth-API-Key": apiKey,
    "X-Auth-Subdomain": subdomain,
    "Content-Type": "application/json",
  };
}

async function thinkificGet<T>(
  path: string,
  headers: Record<string, string>,
  params: Record<string, string | number | boolean> = {}
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
  extraParams: Record<string, string | number | boolean> = {}
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
    if (page <= totalPages) await sleep(RATE_LIMIT_MS);
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
      "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN must be set to fetch live data."
    );
  }

  const headers = makeHeaders(apiKey, subdomain);

  const pathwayCourses = [
    env.thinkificLevel1Id && { courseId: env.thinkificLevel1Id, level: 1, tier: "certified" as const },
    env.thinkificLevel2Id && { courseId: env.thinkificLevel2Id, level: 2, tier: "instructor" as const },
    env.thinkificLevel3Id && { courseId: env.thinkificLevel3Id, level: 3, tier: "master" as const },
  ].filter((course): course is { courseId: number; level: number; tier: CoachTier } => Boolean(course));

  if (pathwayCourses.length === 0) {
    // No course IDs configured — list all courses and throw so the caller can surface this
    const courses = await fetchAllPages<ThinkificCourse>("/courses", headers);
    const list = courses.map((c) => `  ${c.id}  ${c.name}`).join("\n");
    throw new Error(
      `No pathway course IDs configured. Set THINKIFIC_LEVEL1_ID / _LEVEL2_ID / _LEVEL3_ID.\n\nAvailable courses:\n${list}`
    );
  }

  const tierRank: Record<CoachTier, number> = {
    certified: 1,
    instructor: 2,
    master: 3,
  };

  const userMap = new Map<
    number,
    { tier: CoachTier; certifications: RawCertification[] }
  >();

  for (const { courseId, level, tier } of pathwayCourses) {
    const enrollments = await fetchAllPages<ThinkificEnrollment>(
      "/enrollments",
      headers,
      { "query[course_id]": courseId, "query[completed]": true }
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
        if (tierRank[tier] > tierRank[existing.tier]) existing.tier = tier;
        existing.certifications.push(cert);
      }
    }
  }

  const coaches: Coach[] = [];
  const userIds = [...userMap.keys()];

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    const { tier, certifications } = userMap.get(userId)!;
    try {
      const user = await thinkificGet<ThinkificUser>(
        `/users/${userId}`,
        headers
      );
      coaches.push({
        thinkificUserId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        tier,
        certifications: certifications.sort((a, b) => a.level - b.level),
      });
    } catch {
      // Skip users we can't load
    }
    if (i < userIds.length - 1) await sleep(RATE_LIMIT_MS);
  }

  return {
    fetchedAt: new Date().toISOString(),
    subdomain,
    totalCoaches: coaches.length,
    tierBreakdown: {
      master: coaches.filter((c) => c.tier === "master").length,
      instructor: coaches.filter((c) => c.tier === "instructor").length,
      certified: coaches.filter((c) => c.tier === "certified").length,
    },
    coaches,
  };
}
