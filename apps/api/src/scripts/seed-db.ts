/**
 * seed-db.ts
 *
 * Step 2 of 2: Read coaches-raw.json (from fetch-thinkific.ts) and
 * upsert records into coach_profiles and coach_certifications.
 *
 * Run:
 *   bun run scripts/seed-db.ts              # live upsert
 *   bun run scripts/seed-db.ts --dry-run    # preview only, no DB writes
 *
 * Env vars required:
 *   DATABASE_URL   - Postgres connection string (prod)
 *                    OR file:./dev.db for SQLite (local)
 *
 * Safe to re-run — uses upsert on (user_id) so existing records are
 * updated rather than duplicated.
 */

import { readFileSync } from "fs";
import type { RawCoach } from "./fetch-thinkific";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const INPUT_FILE = "coaches-raw.json";

if (DRY_RUN) {
  console.log("🔍  DRY RUN — no database writes will occur\n");
}

// ---------------------------------------------------------------------------
// DB setup (Drizzle — switches between Postgres and SQLite via DATABASE_URL)
// ---------------------------------------------------------------------------

// NOTE: This import structure assumes the seed script runs from the
// apps/api directory where the db module lives.
//
// If DATABASE_URL starts with "file:" → SQLite (local dev)
// Otherwise → Postgres (production / staging)
//
// We do a dynamic import so the right driver is selected at runtime.

async function getDb() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";

  if (url.startsWith("file:")) {
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(url.replace("file:", ""));
    return drizzle(sqlite);
  } else {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const client = postgres(url);
    return drizzle(client);
  }
}

// ---------------------------------------------------------------------------
// Schema (inline so this script is self-contained)
// In production this would import from ../db/schema.ts
// ---------------------------------------------------------------------------

import {
  pgTable,
  text,
  real,
  boolean,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const coachProfiles = pgTable(
  "coach_profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    thinkificId: integer("thinkific_id"),
    name: text("name").notNull(),
    bio: text("bio"),
    specialty: text("specialty"),
    photoUrl: text("photo_url"),
    city: text("city"),
    state: text("state"),
    country: text("country").default("US"),
    lat: real("lat"),
    lng: real("lng"),
    email: text("email"),
    website: text("website"),
    instagram: text("instagram"),
    tier: text("tier", {
      enum: ["master", "instructor", "certified"],
    }),
    verified: boolean("verified").default(false),
    takesClients: boolean("takes_clients").default(true),
    isPublished: boolean("is_published").default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({ userIdIdx: uniqueIndex("coach_profiles_user_id_idx").on(t.userId) })
);

const coachCertifications = pgTable("coach_certifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  level: integer("level").notNull(),
  completedAt: timestamp("completed_at"),
  certifiedBy: text("certified_by").default("thinkific"),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

/** Build a synthetic user_id from Thinkific ID until real auth is wired up */
function syntheticUserId(thinkificId: number): string {
  return `thinkific_${thinkificId}`;
}

function tierLabel(tier: string): string {
  return { master: "Master Instructor", instructor: "Instructor", certified: "Certified Coach" }[tier] ?? tier;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // ------------------------------------------------------------------
  // Read input file
  // ------------------------------------------------------------------

  let raw: { coaches: RawCoach[]; fetchedAt: string; subdomain: string };

  try {
    raw = JSON.parse(readFileSync(INPUT_FILE, "utf-8"));
  } catch {
    console.error(`❌  Could not read ${INPUT_FILE}.`);
    console.error("    Run fetch-thinkific.ts first.\n");
    process.exit(1);
  }

  const { coaches, fetchedAt, subdomain } = raw;
  console.log(`📄  Loaded ${coaches.length} coaches from ${INPUT_FILE}`);
  console.log(`    Fetched: ${fetchedAt} (subdomain: ${subdomain})\n`);

  // ------------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------------

  const tierCounts = coaches.reduce(
    (acc, c) => ({ ...acc, [c.tier]: (acc[c.tier as keyof typeof acc] ?? 0) + 1 }),
    { master: 0, instructor: 0, certified: 0 }
  );

  console.log("Tier breakdown:");
  console.log(`  🥇 Master Instructors : ${tierCounts.master}`);
  console.log(`  🥈 Instructors        : ${tierCounts.instructor}`);
  console.log(`  🥉 Certified Coaches  : ${tierCounts.certified}`);
  console.log(`  📊 Total              : ${coaches.length}\n`);

  if (DRY_RUN) {
    console.log("── DRY RUN PREVIEW ─────────────────────────────────────\n");
    for (const coach of coaches.slice(0, 10)) {
      console.log(
        `  ${tierLabel(coach.tier).padEnd(20)}  ${coach.fullName.padEnd(30)}  ${coach.email}`
      );
    }
    if (coaches.length > 10) {
      console.log(`  ... and ${coaches.length - 10} more`);
    }
    console.log("\n✅  Dry run complete — no changes made.");
    console.log(
      "    Remove --dry-run flag to write to the database.\n"
    );
    return;
  }

  // ------------------------------------------------------------------
  // Connect to DB
  // ------------------------------------------------------------------

  console.log("🔌  Connecting to database...");
  const db = await getDb();
  console.log(`    DATABASE_URL: ${process.env.DATABASE_URL ?? "file:./dev.db"}\n`);

  // ------------------------------------------------------------------
  // Upsert loop
  // ------------------------------------------------------------------

  let inserted = 0;
  let updated = 0;
  let certRows = 0;
  const errors: string[] = [];

  for (const coach of coaches) {
    const userId = syntheticUserId(coach.thinkificId);

    try {
      // Upsert coach_profiles — ON CONFLICT (user_id) update tier
      // but don't overwrite any fields the coach may have filled in
      // (bio, photo, location, etc.) if they already exist.
      const existing = await db
        .select()
        .from(coachProfiles)
        .where(eq(coachProfiles.userId, userId))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(coachProfiles).values({
          userId,
          thinkificId: coach.thinkificId,
          name: coach.fullName,
          email: coach.email,
          bio: coach.bio ?? null,
          photoUrl: coach.avatarUrl ?? null,
          tier: coach.tier,
          isPublished: false, // admin must approve before going live
        });
        inserted++;
        process.stdout.write(`  ✓ INSERT  `);
      } else {
        // Only update tier (upward only) and thinkificId — don't clobber
        // anything the coach or admin has already set
        const current = existing[0];
        const tierRank = { certified: 1, instructor: 2, master: 3 } as const;
        const shouldUpgradeTier =
          (tierRank[coach.tier] ?? 0) >
          (tierRank[current.tier as keyof typeof tierRank] ?? 0);

        if (shouldUpgradeTier || !current.thinkificId) {
          await db
            .update(coachProfiles)
            .set({
              ...(shouldUpgradeTier && { tier: coach.tier }),
              thinkificId: coach.thinkificId,
              updatedAt: new Date(),
            })
            .where(eq(coachProfiles.userId, userId));
          updated++;
          process.stdout.write(`  ↑ UPDATE  `);
        } else {
          process.stdout.write(`  – SKIP    `);
        }
      }

      console.log(`${coach.fullName.padEnd(32)} ${tierLabel(coach.tier)}`);

      // Insert certification records (skip duplicates)
      for (const cert of coach.certifications) {
        const existingCert = await db
          .select()
          .from(coachCertifications)
          .where(
            and(
              eq(coachCertifications.userId, userId),
              eq(coachCertifications.level, cert.level)
            )
          )
          .limit(1);

        if (existingCert.length === 0) {
          await db.insert(coachCertifications).values({
            userId,
            level: cert.level,
            completedAt: cert.completedAt ? new Date(cert.completedAt) : null,
            certifiedBy: "thinkific",
          });
          certRows++;
        }
      }
    } catch (err) {
      const msg = `${coach.fullName} (id: ${coach.thinkificId}): ${(err as Error).message}`;
      errors.push(msg);
      console.log(`  ✗ ERROR   ${coach.fullName}`);
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------

  console.log("\n── SEED COMPLETE ───────────────────────────────────────\n");
  console.log(`  Profiles inserted    : ${inserted}`);
  console.log(`  Profiles updated     : ${updated}`);
  console.log(`  Certifications added : ${certRows}`);

  if (errors.length > 0) {
    console.log(`\n  ⚠️  ${errors.length} error(s):`);
    for (const e of errors) console.log(`     - ${e}`);
  }

  console.log(
    "\n  All profiles seeded with is_published = false."
  );
  console.log(
    "  Review in the admin panel and publish coaches individually.\n"
  );
}

// Drizzle operators — imported here to keep the script self-contained
import { eq, and } from "drizzle-orm";

main().catch((err) => {
  console.error("\n❌ ", err.message);
  process.exit(1);
});
