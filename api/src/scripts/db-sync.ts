/**
 * Sync the *curated* coach tables between your local sqlite DB and the live
 * Postgres DB:
 *   - coach_overrides   (locations, bios, avatars, Master grants)
 *   - manual_coaches    (house coaches not in Thinkific)
 *   - coach_email_links (email aliases)
 *
 * Intentionally NOT synced:
 *   - thinkific_coaches_cache / _meta — rebuildable from Thinkific; use
 *     `resync-thinkific.ts` (or POST /api/coaches/resync) for that.
 *   - coach_login_codes / coach_sessions — short-lived auth state; copying
 *     session tokens across environments would be a security footgun.
 *
 * Semantics: upsert/merge by natural key (non-destructive — it never deletes
 * rows the source is missing). Wrapped in a transaction on the destination.
 *
 * Usage:
 *   LIVE_DATABASE_URL=<pg-url> bun run api/src/scripts/db-sync.ts pull
 *   LIVE_DATABASE_URL=<pg-url> bun run api/src/scripts/db-sync.ts push --yes
 *
 *   pull = live  → local   (safe; writes only your local sqlite)
 *   push = local → live     (modifies production; requires --yes)
 *
 * With Railway (the public proxy URL is reachable from your machine):
 *   railway service Postgres
 *   railway run bash -c 'LIVE_DATABASE_URL="$DATABASE_PUBLIC_URL" \
 *     bun run api/src/scripts/db-sync.ts pull'
 */
import { Pool } from "pg";
import { getSqliteDb } from "../lib/db/db";
import { SQLITE_SCHEMA_SQL } from "../lib/db/schema";

type Direction = "pull" | "push";

interface TableSync {
  name: string;
  /** Data columns to copy (no autoincrement id / timestamps). */
  columns: string[];
  /** ON CONFLICT target. */
  conflict: string;
}

const TABLES: TableSync[] = [
  {
    name: "coach_overrides",
    columns: [
      "thinkific_user_id",
      "bio",
      "avatar_url",
      "city",
      "state",
      "lat",
      "lng",
      "is_master",
    ],
    conflict: "thinkific_user_id",
  },
  {
    name: "manual_coaches",
    columns: [
      "email",
      "first_name",
      "last_name",
      "avatar_url",
      "bio",
      "company",
      "tier",
      "city",
      "state",
      "lat",
      "lng",
    ],
    conflict: "email",
  },
  {
    name: "coach_email_links",
    columns: ["thinkific_user_id", "email", "source"],
    conflict: "email",
  },
];

const direction = process.argv[2] as Direction | undefined;
const confirmed = process.argv.includes("--yes");

if (direction !== "pull" && direction !== "push") {
  console.error(
    "Usage: bun run api/src/scripts/db-sync.ts <pull|push> [--yes]\n" +
      "  pull = live → local, push = local → live (push needs --yes)",
  );
  process.exit(1);
}

const liveUrl = process.env.LIVE_DATABASE_URL;
if (!liveUrl) {
  console.error(
    "LIVE_DATABASE_URL is required (the live Postgres connection string).\n" +
      'With Railway: railway run bash -c \'LIVE_DATABASE_URL="$DATABASE_PUBLIC_URL" bun run …\'',
  );
  process.exit(1);
}

// Coerce a value for the destination dialect: normalize the is_master flag
// (sqlite 0/1 ↔ pg boolean) and ids (pg returns BIGINT as a string).
function coerce(col: string, val: unknown, dest: "sqlite" | "pg"): unknown {
  if (val === undefined) return null;
  if (col === "is_master") {
    const truthy = val === true || val === 1 || val === "1" || val === "t";
    return dest === "pg" ? truthy : truthy ? 1 : 0;
  }
  if (col === "thinkific_user_id" && val != null) return Number(val);
  return val ?? null;
}

function upsertSql(t: TableSync, dialect: "sqlite" | "pg"): string {
  const cols = t.columns.join(", ");
  const placeholders =
    dialect === "pg"
      ? t.columns.map((_, i) => `$${i + 1}`).join(", ")
      : t.columns.map(() => "?").join(", ");
  const kw = dialect === "pg" ? "EXCLUDED" : "excluded";
  const updates = t.columns
    .filter((c) => c !== t.conflict)
    .map((c) => `${c} = ${kw}.${c}`)
    .join(", ");
  return `INSERT INTO ${t.name} (${cols}) VALUES (${placeholders}) ON CONFLICT(${t.conflict}) DO UPDATE SET ${updates}`;
}

const pg = new Pool({
  connectionString: liveUrl,
  ssl: liveUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

async function readPg(t: TableSync): Promise<Record<string, unknown>[]> {
  const r = await pg.query(`SELECT ${t.columns.join(", ")} FROM ${t.name}`);
  return r.rows;
}

function readSqlite(t: TableSync): Record<string, unknown>[] {
  return getSqliteDb()
    .query<Record<string, unknown>, []>(
      `SELECT ${t.columns.join(", ")} FROM ${t.name}`,
    )
    .all();
}

interface Dataset {
  t: TableSync;
  rows: Record<string, unknown>[];
}

async function main() {
  const counts: Record<string, number> = {};

  if (direction === "pull") {
    // live (pg) → local (sqlite)
    const datasets: Dataset[] = [];
    for (const t of TABLES) datasets.push({ t, rows: await readPg(t) });

    const db = getSqliteDb();
    db.exec(SQLITE_SCHEMA_SQL); // ensure tables exist on a fresh local DB
    const run = db.transaction(() => {
      for (const { t, rows } of datasets) {
        const sql = upsertSql(t, "sqlite");
        for (const row of rows) {
          db.run(
            sql,
            t.columns.map((c) => coerce(c, row[c], "sqlite")) as never[],
          );
        }
        counts[t.name] = rows.length;
      }
    });
    run();
  } else {
    // local (sqlite) → live (pg)
    const datasets: Dataset[] = [];
    for (const t of TABLES) datasets.push({ t, rows: readSqlite(t) });

    const total = datasets.reduce((n, d) => n + d.rows.length, 0);
    if (!confirmed) {
      console.log(`DRY RUN — would push ${total} rows to LIVE:`);
      for (const { t, rows } of datasets) console.log(`  ${t.name}: ${rows.length}`);
      console.log("\nRe-run with --yes to apply.");
      return;
    }

    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      for (const { t, rows } of datasets) {
        const sql = upsertSql(t, "pg");
        for (const row of rows) {
          await client.query(
            sql,
            t.columns.map((c) => coerce(c, row[c], "pg")),
          );
        }
        counts[t.name] = rows.length;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  const arrow = direction === "pull" ? "live → local" : "local → live";
  console.log(`✓ ${direction} (${arrow}) complete:`);
  for (const t of TABLES) console.log(`  ${t.name}: ${counts[t.name] ?? 0} rows`);
}

try {
  await main();
  await pg.end();
  process.exit(0);
} catch (err) {
  console.error("Error:", (err as Error).message);
  await pg.end().catch(() => {});
  process.exit(1);
}
