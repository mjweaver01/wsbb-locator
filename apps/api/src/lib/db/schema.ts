import { db } from "./db";
import { getPgPool } from "./pg";

const pgPool = getPgPool();

export const dbMode = pgPool ? "postgres" : "sqlite";
export const isPostgresDb = dbMode === "postgres";

let schemaInitPromise: Promise<void> | null = null;

const SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS coach_overrides (
    thinkific_user_id INTEGER PRIMARY KEY,
    bio TEXT,
    avatar_url TEXT,
    city TEXT,
    state TEXT,
    lat REAL,
    lng REAL,
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
    tier TEXT NOT NULL CHECK (tier IN ('certified', 'instructor', 'master')),
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
    bio TEXT,
    avatar_url TEXT,
    city TEXT,
    state TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
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

  CREATE TABLE IF NOT EXISTS coach_email_links (
    id BIGSERIAL PRIMARY KEY,
    thinkific_user_id BIGINT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_coach_email_links_thinkific_user_id
  ON coach_email_links(thinkific_user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_email_links_lower_email
  ON coach_email_links (lower(email));

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
    tier TEXT NOT NULL CHECK (tier IN ('certified', 'instructor', 'master')),
    city TEXT,
    state TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    certifications_json TEXT NOT NULL
  );
`;

export async function ensureDbSchema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;

  if (isPostgresDb) {
    schemaInitPromise = pgPool!
      .query(POSTGRES_SCHEMA_SQL)
      .then(() => undefined);
  } else {
    db.exec(SQLITE_SCHEMA_SQL);
    schemaInitPromise = Promise.resolve();
  }

  return schemaInitPromise;
}
