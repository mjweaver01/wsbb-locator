import { getPgPool, requirePgPool } from "./pg";
import { getSqliteDb } from "./db";

const pgPool = getPgPool();

export const dbMode = pgPool ? "postgres" : "sqlite";
export const isPostgresDb = dbMode === "postgres";

let schemaInitPromise: Promise<void> | null = null;

export const SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS coach_overrides (
    thinkific_user_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    city TEXT,
    state TEXT,
    lat REAL,
    lng REAL,
    is_master INTEGER NOT NULL DEFAULT 0,
    is_instructor INTEGER NOT NULL DEFAULT 0,
    is_founder INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coach_login_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_coach_login_codes_lookup
  ON coach_login_codes(thinkific_user_id, email, created_at DESC);

  CREATE TABLE IF NOT EXISTS coach_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coach_email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_coach_email_links_thinkific_user_id
  ON coach_email_links(thinkific_user_id);

  CREATE TABLE IF NOT EXISTS manual_coaches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    company TEXT,
    tier TEXT NOT NULL,
    city TEXT,
    state TEXT,
    lat REAL,
    lng REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS thinkific_cache_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at TEXT NOT NULL,
    subdomain TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS thinkific_coaches_cache (
    thinkific_user_id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    tier TEXT NOT NULL,
    city TEXT,
    state TEXT,
    lat REAL,
    lng REAL,
    certifications_json TEXT NOT NULL
  );
`;

const POSTGRES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS coach_overrides (
    thinkific_user_id BIGINT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    city TEXT,
    state TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    is_master BOOLEAN NOT NULL DEFAULT FALSE,
    is_instructor BOOLEAN NOT NULL DEFAULT FALSE,
    is_founder BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS coach_login_codes (
    id BIGSERIAL PRIMARY KEY,
    thinkific_user_id BIGINT NOT NULL,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_coach_login_codes_lookup
  ON coach_login_codes(thinkific_user_id, lower(email), created_at DESC);

  CREATE TABLE IF NOT EXISTS coach_sessions (
    id BIGSERIAL PRIMARY KEY,
    thinkific_user_id BIGINT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- App-level invariant: emails are lowercased before insert (see
  -- normalizeEmail in email-links.ts), so a case-sensitive UNIQUE on the
  -- column is sufficient and lets us target it with ON CONFLICT (email).
  CREATE TABLE IF NOT EXISTS coach_email_links (
    id BIGSERIAL PRIMARY KEY,
    thinkific_user_id BIGINT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_coach_email_links_thinkific_user_id
  ON coach_email_links(thinkific_user_id);

  CREATE TABLE IF NOT EXISTS manual_coaches (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    company TEXT,
    tier TEXT NOT NULL,
    city TEXT,
    state TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS thinkific_cache_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at TIMESTAMPTZ NOT NULL,
    subdomain TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS thinkific_coaches_cache (
    thinkific_user_id BIGINT PRIMARY KEY,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    tier TEXT NOT NULL,
    city TEXT,
    state TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    certifications_json TEXT NOT NULL
  );
`;

// Idempotent migrations for databases created before a column/constraint
// change. `CREATE TABLE IF NOT EXISTS` never alters an existing table, so
// these bring older tables up to date.
const POSTGRES_MIGRATIONS_SQL = `
  ALTER TABLE coach_overrides
    ADD COLUMN IF NOT EXISTS first_name TEXT;
  ALTER TABLE coach_overrides
    ADD COLUMN IF NOT EXISTS last_name TEXT;
  ALTER TABLE coach_overrides
    ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE coach_overrides
    ADD COLUMN IF NOT EXISTS is_instructor BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE coach_overrides
    ADD COLUMN IF NOT EXISTS is_founder BOOLEAN NOT NULL DEFAULT FALSE;
  -- The tier CHECK constraint used to forbid the 'candidate' tier; drop it.
  ALTER TABLE thinkific_coaches_cache
    DROP CONSTRAINT IF EXISTS thinkific_coaches_cache_tier_check;
`;

function migrateSqlite(): void {
  const db = getSqliteDb();

  const overrideCols = db
    .query<{ name: string }, []>(`PRAGMA table_info(coach_overrides)`)
    .all();
  if (!overrideCols.some((c) => c.name === "first_name")) {
    db.run(`ALTER TABLE coach_overrides ADD COLUMN first_name TEXT`);
  }
  if (!overrideCols.some((c) => c.name === "last_name")) {
    db.run(`ALTER TABLE coach_overrides ADD COLUMN last_name TEXT`);
  }
  if (!overrideCols.some((c) => c.name === "is_master")) {
    db.run(
      `ALTER TABLE coach_overrides ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!overrideCols.some((c) => c.name === "is_instructor")) {
    db.run(
      `ALTER TABLE coach_overrides ADD COLUMN is_instructor INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!overrideCols.some((c) => c.name === "is_founder")) {
    db.run(
      `ALTER TABLE coach_overrides ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0`,
    );
  }

  // The cache table once carried a tier CHECK that forbids 'candidate'.
  // SQLite can't drop a CHECK in place, so recreate the (disposable) cache
  // table when the old constraint is still present.
  const cacheTable = db
    .query<{ sql: string | null }, []>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='thinkific_coaches_cache'`,
    )
    .get();
  if (cacheTable?.sql?.includes("CHECK")) {
    db.run(`DROP TABLE thinkific_coaches_cache`);
    db.exec(SQLITE_SCHEMA_SQL);
  }
}

export async function ensureDbSchema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;

  if (isPostgresDb) {
    // Don't memoize a rejected promise — a transient PG hiccup during the
    // first startup query would otherwise wedge every later request.
    schemaInitPromise = requirePgPool()
      .query(POSTGRES_SCHEMA_SQL)
      .then(() => requirePgPool().query(POSTGRES_MIGRATIONS_SQL))
      .then(() => undefined)
      .catch((err) => {
        schemaInitPromise = null;
        throw err;
      });
  } else {
    getSqliteDb().exec(SQLITE_SCHEMA_SQL);
    migrateSqlite();
    schemaInitPromise = Promise.resolve();
  }

  return schemaInitPromise;
}
