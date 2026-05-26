import type { Coach } from "../thinkific";
import { db } from "./db";
import { getPgPool } from "./pg";

export type CoachOverride = Partial<
  Pick<Coach, "bio" | "avatarUrl" | "city" | "state" | "lat" | "lng">
>;

interface CoachOverrideRow {
  thinkific_user_id: number;
  bio: string | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}

const pgPool = getPgPool();
export const coachOverridesDbDriver = pgPool ? "postgres" : "sqlite";
let pgInitPromise: Promise<void> | null = null;

if (!pgPool) {
  db.exec(`
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
  `);
}

async function ensurePgCoachOverridesTable(): Promise<void> {
  if (!pgPool) return;
  if (pgInitPromise) return pgInitPromise;
  pgInitPromise = pgPool
    .query(`
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
    `)
    .then(() => undefined);
  return pgInitPromise ?? Promise.resolve();
}

function toOverride(row: CoachOverrideRow): CoachOverride {
  return {
    ...(row.bio !== null ? { bio: row.bio } : {}),
    ...(row.avatar_url !== null ? { avatarUrl: row.avatar_url } : {}),
    ...(row.city !== null ? { city: row.city } : {}),
    ...(row.state !== null ? { state: row.state } : {}),
    ...(row.lat !== null ? { lat: row.lat } : {}),
    ...(row.lng !== null ? { lng: row.lng } : {}),
  };
}

export async function getCoachOverride(
  thinkificUserId: number,
): Promise<CoachOverride | null> {
  if (pgPool) {
    await ensurePgCoachOverridesTable();
    const result = await pgPool.query<CoachOverrideRow>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides
       WHERE thinkific_user_id = $1`,
      [thinkificUserId],
    );
    const row = result.rows[0];
    return row ? toOverride(row) : null;
  }

  const row = db
    .query<CoachOverrideRow, [number]>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides
       WHERE thinkific_user_id = ?`,
    )
    .get(thinkificUserId);

  return row ? toOverride(row) : null;
}

export async function listCoachOverrides(): Promise<Record<string, CoachOverride>> {
  if (pgPool) {
    await ensurePgCoachOverridesTable();
    const result = await pgPool.query<CoachOverrideRow>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides`,
    );
    const out: Record<string, CoachOverride> = {};
    for (const row of result.rows) {
      out[String(row.thinkific_user_id)] = toOverride(row);
    }
    return out;
  }

  const rows = db
    .query<CoachOverrideRow, []>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides`,
    )
    .all();

  const out: Record<string, CoachOverride> = {};
  for (const row of rows) {
    out[String(row.thinkific_user_id)] = toOverride(row);
  }
  return out;
}

/**
 * Full-replace upsert. The override row mirrors exactly what was passed in —
 * any field not supplied becomes NULL in the row.
 */
export async function upsertCoachOverride(
  thinkificUserId: number,
  override: CoachOverride,
): Promise<CoachOverride> {
  if (pgPool) {
    await ensurePgCoachOverridesTable();
    await pgPool.query(
      `INSERT INTO coach_overrides (
        thinkific_user_id, bio, avatar_url, city, state, lat, lng, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT(thinkific_user_id) DO UPDATE SET
        bio        = EXCLUDED.bio,
        avatar_url = EXCLUDED.avatar_url,
        city       = EXCLUDED.city,
        state      = EXCLUDED.state,
        lat        = EXCLUDED.lat,
        lng        = EXCLUDED.lng,
        updated_at = NOW()`,
      [
        thinkificUserId,
        override.bio ?? null,
        override.avatarUrl ?? null,
        override.city ?? null,
        override.state ?? null,
        override.lat ?? null,
        override.lng ?? null,
      ],
    );
    return override;
  }

  db.run(
    `INSERT INTO coach_overrides (
      thinkific_user_id, bio, avatar_url, city, state, lat, lng, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(thinkific_user_id) DO UPDATE SET
      bio        = excluded.bio,
      avatar_url = excluded.avatar_url,
      city       = excluded.city,
      state      = excluded.state,
      lat        = excluded.lat,
      lng        = excluded.lng,
      updated_at = CURRENT_TIMESTAMP`,
    [
      thinkificUserId,
      override.bio ?? null,
      override.avatarUrl ?? null,
      override.city ?? null,
      override.state ?? null,
      override.lat ?? null,
      override.lng ?? null,
    ],
  );

  return override;
}

export async function deleteCoachOverride(thinkificUserId: number): Promise<void> {
  if (pgPool) {
    await ensurePgCoachOverridesTable();
    await pgPool.query(`DELETE FROM coach_overrides WHERE thinkific_user_id = $1`, [
      thinkificUserId,
    ]);
    return;
  }

  db.run(`DELETE FROM coach_overrides WHERE thinkific_user_id = ?`, [
    thinkificUserId,
  ]);
}
