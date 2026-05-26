import type { Coach } from "../thinkific";
import { db } from "./db";

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

export function getCoachOverride(thinkificUserId: number): CoachOverride | null {
  const row = db
    .query<CoachOverrideRow, [number]>(
      `SELECT thinkific_user_id, bio, avatar_url, city, state, lat, lng
       FROM coach_overrides
       WHERE thinkific_user_id = ?`,
    )
    .get(thinkificUserId);

  return row ? toOverride(row) : null;
}

export function listCoachOverrides(): Record<string, CoachOverride> {
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
export function upsertCoachOverride(
  thinkificUserId: number,
  override: CoachOverride,
): CoachOverride {
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

export function deleteCoachOverride(thinkificUserId: number): void {
  db.run(`DELETE FROM coach_overrides WHERE thinkific_user_id = ?`, [
    thinkificUserId,
  ]);
}
