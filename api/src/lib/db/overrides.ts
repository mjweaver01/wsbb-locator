import type { Coach } from "@shared/coach";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { dbMode, ensureDbSchema, isPostgresDb } from "./schema";

export type CoachOverride = Partial<
  Pick<Coach, "bio" | "avatarUrl" | "city" | "state" | "lat" | "lng">
> & {
  /** Admin-granted Master Instructor status. Promotes the coach's tier. */
  isMaster?: boolean;
};

interface CoachOverrideRow {
  thinkific_user_id: number;
  bio: string | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  // SQLite stores 0/1; Postgres stores a boolean. Boolean() normalizes both.
  is_master: number | boolean | null;
}

const OVERRIDE_COLUMNS = `thinkific_user_id, bio, avatar_url, city, state, lat, lng, is_master`;

export const coachOverridesDbDriver = dbMode;

function toOverride(row: CoachOverrideRow): CoachOverride {
  return {
    ...(row.bio !== null ? { bio: row.bio } : {}),
    ...(row.avatar_url !== null ? { avatarUrl: row.avatar_url } : {}),
    ...(row.city !== null ? { city: row.city } : {}),
    ...(row.state !== null ? { state: row.state } : {}),
    ...(row.lat !== null ? { lat: row.lat } : {}),
    ...(row.lng !== null ? { lng: row.lng } : {}),
    ...(row.is_master ? { isMaster: true } : {}),
  };
}

export async function getCoachOverride(
  thinkificUserId: number,
): Promise<CoachOverride | null> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachOverrideRow>(
      `SELECT ${OVERRIDE_COLUMNS}
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
      `SELECT ${OVERRIDE_COLUMNS}
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
      `SELECT ${OVERRIDE_COLUMNS} FROM coach_overrides`,
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
      `SELECT ${OVERRIDE_COLUMNS} FROM coach_overrides`,
    )
    .all();

  const out: Record<string, CoachOverride> = {};
  for (const row of rows) {
    out[String(row.thinkific_user_id)] = toOverride(row);
  }
  return out;
}

/**
 * Full-replace upsert of the self-serve profile fields. Any field not supplied
 * becomes NULL in the row. `is_master` is deliberately left out of both the
 * column list and the conflict update so an admin's Master grant survives a
 * coach editing their own profile (and new rows default to non-master).
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

/**
 * Grant or revoke admin-bestowed Master Instructor status for a coach. Touches
 * only `is_master`, leaving any self-serve profile override fields intact.
 */
export async function setCoachMaster(
  thinkificUserId: number,
  isMaster: boolean,
): Promise<void> {
  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
      `INSERT INTO coach_overrides (thinkific_user_id, is_master, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT(thinkific_user_id) DO UPDATE SET
         is_master = EXCLUDED.is_master,
         updated_at = NOW()`,
      [thinkificUserId, isMaster],
    );
    return;
  }

  const db = getSqliteDb();
  db.run(
    `INSERT INTO coach_overrides (thinkific_user_id, is_master, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(thinkific_user_id) DO UPDATE SET
       is_master = excluded.is_master,
       updated_at = CURRENT_TIMESTAMP`,
    [thinkificUserId, isMaster ? 1 : 0],
  );
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
