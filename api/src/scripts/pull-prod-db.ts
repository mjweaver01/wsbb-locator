/**
 * Pull prod Postgres data into the local SQLite database.
 *
 * Syncs data tables only — skips ephemeral auth state (sessions, login codes).
 * Run via:
 *   railway run --service coaches bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" LOCAL_DB_PATH="api/data/coach-data.sqlite" bun run api/src/scripts/pull-prod-db.ts'
 */
import { Database } from "bun:sqlite";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const pgUrl = process.env.DATABASE_URL;
if (!pgUrl) {
  console.error("DATABASE_URL is required (point it at DATABASE_PUBLIC_URL)");
  process.exit(1);
}

const localPath =
  process.env.LOCAL_DB_PATH ??
  `${import.meta.dir}/../../data/coach-data.sqlite`;

mkdirSync(dirname(localPath), { recursive: true });

const pg = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
const sqlite = new Database(localPath);

// pg returns TIMESTAMPTZ as JS Date and BIGINT as string; SQLite can only bind
// string/number/boolean/null/bigint/TypedArray. Normalize each value.
function bind(value: unknown): string | number | boolean | bigint | Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return String(value);
}

// Ensure local schema exists before we write into it.
const { ensureDbSchema } = await import("../lib/db/schema");
await ensureDbSchema();

async function syncTable<Row extends Record<string, unknown>>(opts: {
  table: string;
  pgSelect: string;
  sqliteUpsert: (row: Row, db: Database) => void;
}) {
  const { rows } = await pg.query<Row>(opts.pgSelect);
  sqlite.exec("BEGIN");
  try {
    for (const row of rows) {
      opts.sqliteUpsert(row, sqlite);
    }
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  console.log(`  ${opts.table}: ${rows.length} rows`);
}

console.log("Pulling prod → local SQLite…");

// thinkific_cache_meta (single row)
await syncTable({
  table: "thinkific_cache_meta",
  pgSelect: "SELECT id, fetched_at, subdomain, synced_at FROM thinkific_cache_meta",
  sqliteUpsert: (row, db) => {
    db.run(
      `INSERT OR REPLACE INTO thinkific_cache_meta (id, fetched_at, subdomain, synced_at)
       VALUES (?, ?, ?, ?)`,
      [row.id, row.fetched_at, row.subdomain, row.synced_at].map(bind),
    );
  },
});

// thinkific_coaches_cache
await syncTable({
  table: "thinkific_coaches_cache",
  pgSelect: `SELECT thinkific_user_id, email, first_name, last_name, full_name,
                    avatar_url, bio, tier, city, state, lat, lng, certifications_json
             FROM thinkific_coaches_cache`,
  sqliteUpsert: (row, db) => {
    db.run(
      `INSERT OR REPLACE INTO thinkific_coaches_cache
         (thinkific_user_id, email, first_name, last_name, full_name,
          avatar_url, bio, tier, city, state, lat, lng, certifications_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.thinkific_user_id, row.email, row.first_name, row.last_name,
        row.full_name, row.avatar_url, row.bio, row.tier,
        row.city, row.state, row.lat, row.lng, row.certifications_json,
      ].map(bind),
    );
  },
});

// coach_overrides
await syncTable({
  table: "coach_overrides",
  pgSelect: `SELECT thinkific_user_id, first_name, last_name, bio, avatar_url,
                    city, state, lat, lng,
                    is_master, is_instructor, is_founder, updated_at
             FROM coach_overrides`,
  sqliteUpsert: (row, db) => {
    db.run(
      `INSERT OR REPLACE INTO coach_overrides
         (thinkific_user_id, first_name, last_name, bio, avatar_url,
          city, state, lat, lng, is_master, is_instructor, is_founder, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.thinkific_user_id, row.first_name, row.last_name, row.bio, row.avatar_url,
        row.city, row.state, row.lat, row.lng,
        row.is_master ? 1 : 0, row.is_instructor ? 1 : 0, row.is_founder ? 1 : 0,
        row.updated_at,
      ].map(bind),
    );
  },
});

// manual_coaches
await syncTable({
  table: "manual_coaches",
  pgSelect: `SELECT email, first_name, last_name, avatar_url, bio, company,
                    tier, city, state, lat, lng, created_at, updated_at
             FROM manual_coaches`,
  sqliteUpsert: (row, db) => {
    db.run(
      `INSERT OR REPLACE INTO manual_coaches
         (email, first_name, last_name, avatar_url, bio, company,
          tier, city, state, lat, lng, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.email, row.first_name, row.last_name, row.avatar_url, row.bio, row.company,
        row.tier, row.city, row.state, row.lat, row.lng, row.created_at, row.updated_at,
      ].map(bind),
    );
  },
});

// coach_email_links
await syncTable({
  table: "coach_email_links",
  pgSelect: `SELECT thinkific_user_id, email, source, created_at FROM coach_email_links`,
  sqliteUpsert: (row, db) => {
    db.run(
      `INSERT OR REPLACE INTO coach_email_links (thinkific_user_id, email, source, created_at)
       VALUES (?, ?, ?, ?)`,
      [row.thinkific_user_id, row.email, row.source, row.created_at].map(bind),
    );
  },
});

await pg.end();
console.log("Done. Local SQLite is up to date with prod.");
