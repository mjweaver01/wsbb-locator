/**
 * fetch-thinkific.ts
 *
 * Step 1 of 2: Pull completed pathway enrollments from Thinkific
 * and save the results to coaches-raw.json for inspection.
 *
 * Run:  bun run scripts/fetch-thinkific.ts
 *
 * Env vars required (.env.local):
 *   THINKIFIC_API_KEY       - from Thinkific Admin → Settings → API
 *   THINKIFIC_SUBDOMAIN     - e.g. "westsidebarbell" (not the full URL)
 *
 * Env vars optional:
 *   THINKIFIC_LEVEL1_ID     - course ID for Level 1 pathway
 *   THINKIFIC_LEVEL2_ID     - course ID for Level 2 pathway
 *   THINKIFIC_LEVEL3_ID     - course ID for Level 3 pathway
 *
 * If course IDs are not set, the script lists all courses so you can
 * find the right IDs and add them to your .env.
 */

import { writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.THINKIFIC_API_KEY;
const SUBDOMAIN = process.env.THINKIFIC_SUBDOMAIN;
const BASE_URL = "https://api.thinkific.com/api/public/v1";
const PAGE_LIMIT = 250; // Thinkific max per page
const RATE_LIMIT_MS = 300; // ms between requests — stay well under any limit

if (!API_KEY || !SUBDOMAIN) {
  console.error("❌  THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN are required.");
  process.exit(1);
}

const headers = {
  "X-Auth-API-Key": API_KEY,
  "X-Auth-Subdomain": SUBDOMAIN,
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Tier mapping — edit these to match actual WSBB course IDs
// ---------------------------------------------------------------------------

const PATHWAY_COURSES: Record<string, { level: number; tier: CoachTier }> = {
  ...(process.env.THINKIFIC_LEVEL1_ID && {
    [process.env.THINKIFIC_LEVEL1_ID]: { level: 1, tier: "certified" },
  }),
  ...(process.env.THINKIFIC_LEVEL2_ID && {
    [process.env.THINKIFIC_LEVEL2_ID]: { level: 2, tier: "instructor" },
  }),
  ...(process.env.THINKIFIC_LEVEL3_ID && {
    [process.env.THINKIFIC_LEVEL3_ID]: { level: 3, tier: "master" },
  }),
};

type CoachTier = "certified" | "instructor" | "master";

// ---------------------------------------------------------------------------
// Thinkific API types
// ---------------------------------------------------------------------------

interface ThinkificUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  roles: string[];
  created_at: string;
}

interface ThinkificEnrollment {
  id: number;
  user_id: number;
  course_id: number;
  activated_at: string | null;
  expiry_date: string | null;
  percentage_completed: number;
  is_free_trial: boolean;
  completed: boolean;
  completed_at: string | null;
  updated_at: string;
}

interface ThinkificCourse {
  id: number;
  name: string;
  slug: string;
  description: string | null;
}

interface ThinkificPagination {
  current_page: number;
  next_page: number | null;
  prev_page: number | null;
  total_pages: number;
  total_count: number;
}

interface ThinkificListResponse<T> {
  items: T[];
  meta: { pagination: ThinkificPagination };
}

// ---------------------------------------------------------------------------
// Output types (what we write to coaches-raw.json)
// ---------------------------------------------------------------------------

export interface RawCoach {
  thinkificUserId: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  tier: CoachTier; // highest completed level
  certifications: Array<{
    level: number;
    courseId: number;
    completedAt: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function thinkificGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Thinkific API ${res.status} on ${path}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/** Fetch all pages of a paginated list endpoint */
async function fetchAllPages<T>(
  path: string,
  extraParams: Record<string, string | number | boolean> = {}
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await thinkificGet<ThinkificListResponse<T>>(path, {
      ...extraParams,
      page,
      limit: PAGE_LIMIT,
    });

    results.push(...data.items);
    totalPages = data.meta.pagination.total_pages;

    console.log(
      `  page ${page}/${totalPages} — ${data.items.length} items`
    );

    page++;
    if (page <= totalPages) await sleep(RATE_LIMIT_MS);
  } while (page <= totalPages);

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍  Connecting to Thinkific...\n");

  // ------------------------------------------------------------------
  // Step 1: List courses — if no pathway IDs are configured, print them
  // and exit so you can fill in .env.
  // ------------------------------------------------------------------

  console.log("📚  Fetching course list...");
  const courses = await fetchAllPages<ThinkificCourse>("/courses");

  if (Object.keys(PATHWAY_COURSES).length === 0) {
    console.log(
      "\n⚠️  No pathway course IDs configured in .env. Here are all courses:\n"
    );
    console.table(
      courses.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
    );
    console.log(
      "\nAdd the relevant course IDs to your .env as:\n" +
        "  THINKIFIC_LEVEL1_ID=<id>\n" +
        "  THINKIFIC_LEVEL2_ID=<id>\n" +
        "  THINKIFIC_LEVEL3_ID=<id>\n"
    );
    process.exit(0);
  }

  // ------------------------------------------------------------------
  // Step 2: For each pathway course, get all completed enrollments
  // ------------------------------------------------------------------

  // userId → { tier, certifications[] }
  const userMap = new Map<
    number,
    { tier: CoachTier; certifications: RawCoach["certifications"] }
  >();

  const tierRank: Record<CoachTier, number> = {
    certified: 1,
    instructor: 2,
    master: 3,
  };

  for (const [courseIdStr, { level, tier }] of Object.entries(PATHWAY_COURSES)) {
    const courseId = parseInt(courseIdStr);
    const course = courses.find((c) => c.id === courseId);
    console.log(
      `\n📋  Level ${level} course: "${course?.name ?? courseId}" (id: ${courseId})`
    );
    console.log("     Fetching completed enrollments...");

    const enrollments = await fetchAllPages<ThinkificEnrollment>(
      "/enrollments",
      {
        "query[course_id]": courseId,
        "query[completed]": true,
      }
    );

    console.log(`     ✓ ${enrollments.length} completed enrollments`);

    for (const enrollment of enrollments) {
      const existing = userMap.get(enrollment.user_id);
      const cert = {
        level,
        courseId,
        completedAt: enrollment.completed_at ?? enrollment.activated_at,
      };

      if (!existing) {
        userMap.set(enrollment.user_id, {
          tier,
          certifications: [cert],
        });
      } else {
        // Upgrade tier if this level is higher
        if (tierRank[tier] > tierRank[existing.tier]) {
          existing.tier = tier;
        }
        existing.certifications.push(cert);
      }
    }
  }

  console.log(
    `\n👥  Found ${userMap.size} unique coaches across all pathway levels`
  );

  // ------------------------------------------------------------------
  // Step 3: Fetch user details for each coach
  // ------------------------------------------------------------------

  console.log("\n🔄  Fetching user profiles...");

  const coaches: RawCoach[] = [];
  const userIds = [...userMap.keys()];

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    const { tier, certifications } = userMap.get(userId)!;

    process.stdout.write(`  [${i + 1}/${userIds.length}] user ${userId}... `);

    try {
      const user = await thinkificGet<ThinkificUser>(`/users/${userId}`);

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

      console.log(`✓  ${user.full_name} (${tier})`);
    } catch (err) {
      console.log(`⚠️  failed — ${(err as Error).message}`);
    }

    if (i < userIds.length - 1) await sleep(RATE_LIMIT_MS);
  }

  // ------------------------------------------------------------------
  // Step 4: Write to coaches-raw.json
  // ------------------------------------------------------------------

  const output = {
    fetchedAt: new Date().toISOString(),
    subdomain: SUBDOMAIN,
    totalCoaches: coaches.length,
    tierBreakdown: {
      master: coaches.filter((c) => c.tier === "master").length,
      instructor: coaches.filter((c) => c.tier === "instructor").length,
      certified: coaches.filter((c) => c.tier === "certified").length,
    },
    coaches,
  };

  writeFileSync("coaches-raw.json", JSON.stringify(output, null, 2));

  console.log("\n✅  Done!");
  console.log(`   Coaches: ${coaches.length} total`);
  console.log(`   Master:     ${output.tierBreakdown.master}`);
  console.log(`   Instructor: ${output.tierBreakdown.instructor}`);
  console.log(`   Certified:  ${output.tierBreakdown.certified}`);
  console.log("\n📄  Saved to coaches-raw.json — review before seeding.");
  console.log("    Next: bun run scripts/seed-db.ts\n");
}

main().catch((err) => {
  console.error("\n❌ ", err.message);
  process.exit(1);
});
