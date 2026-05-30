import type { Coach } from "@shared/coach";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { dbMode, ensureDbSchema, isPostgresDb } from "./schema";

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

export const coachOverridesDbDriver = dbMode;

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
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachOverrideRow>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides
       WHERE thinkific_user_id = $1`,
      [thinkificUserId],
    );
    const row = result.rows[0];
    return row ? toOverride(row) : null;
  }

  const db = getSqliteDb();
  const row = db
    .query<CoachOverrideRow, [number]>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides
       WHERE thinkific_user_id = ?`,
    )
    .get(thinkificUserId);

  return row ? toOverride(row) : null;
}

export async function listCoachOverrides(): Promise<
  Record<string, CoachOverride>
> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachOverrideRow>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides`,
    );
    const out: Record<string, CoachOverride> = {};
    for (const row of result.rows) {
      out[String(row.thinkific_user_id)] = toOverride(row);
    }
    return out;
  }

  const db = getSqliteDb();
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
  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
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

  const db = getSqliteDb();
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

export async function deleteCoachOverride(
  thinkificUserId: number,
): Promise<void> {
  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
      `DELETE FROM coach_overrides WHERE thinkific_user_id = $1`,
      [thinkificUserId],
    );
    return;
  }

  const db = getSqliteDb();
  db.run(`DELETE FROM coach_overrides WHERE thinkific_user_id = ?`, [
    thinkificUserId,
  ]);
}
