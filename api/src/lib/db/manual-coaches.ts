/**
 * Manually-added ("house") coaches that don't come from Thinkific — e.g. the
 * company owner or staff who never took the certification courses. Unlike the
 * Thinkific flow, these rows carry their own identity, tier and location, and
 * are appended to the served directory in `coaches-cache.ts`.
 *
 * Their synthetic `thinkificUserId` is the negated row id (−1, −2, …) so it can
 * never collide with a real (positive) Thinkific user id while still satisfying
 * the numeric-id contract the rest of the app expects.
 */
import type { Coach, CoachTier } from "@shared/coach";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { ensureDbSchema, isPostgresDb } from "./schema";

export interface ManualCoachInput {
  email: string;
  firstName: string;
  lastName: string;
  tier: CoachTier;
  bio?: string | null;
  avatarUrl?: string | null;
  company?: string | null;
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface ManualCoachRow {
  id: number | string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  bio: string | null;
  company: string | null;
  tier: CoachTier;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}

const COLUMNS = `id, email, first_name, last_name, avatar_url, bio, company, tier, city, state, lat, lng`;

function toCoach(row: ManualCoachRow): Coach {
  const firstName = row.first_name;
  const lastName = row.last_name;
  return {
    // Negated row id — guaranteed distinct from positive Thinkific ids.
    thinkificUserId: -Number(row.id),
    email: row.email,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    avatarUrl: row.avatar_url,
    bio: row.bio,
    company: row.company,
    tier: row.tier,
    certifications: [],
    ...(row.city !== null ? { city: row.city } : {}),
    ...(row.state !== null ? { state: row.state } : {}),
    ...(row.lat !== null ? { lat: row.lat } : {}),
    ...(row.lng !== null ? { lng: row.lng } : {}),
  };
}

export async function listManualCoaches(): Promise<Coach[]> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<ManualCoachRow>(
      `SELECT ${COLUMNS} FROM manual_coaches ORDER BY first_name, last_name`,
    );
    return result.rows.map(toCoach);
  }

  const db = getSqliteDb();
  const rows = db
    .query<ManualCoachRow, []>(
      `SELECT ${COLUMNS} FROM manual_coaches ORDER BY first_name, last_name`,
    )
    .all();
  return rows.map(toCoach);
}

/** Upsert a manual coach, keyed by email (case-insensitive). */
export async function upsertManualCoach(input: ManualCoachInput): Promise<void> {
  await ensureDbSchema();
  const email = input.email.trim().toLowerCase();
  const values = [
    email,
    input.firstName,
    input.lastName,
    input.avatarUrl ?? null,
    input.bio ?? null,
    input.company ?? null,
    input.tier,
    input.city ?? null,
    input.state ?? null,
    input.lat ?? null,
    input.lng ?? null,
  ];

  if (isPostgresDb) {
    await requirePgPool().query(
      `INSERT INTO manual_coaches (
        email, first_name, last_name, avatar_url, bio, company, tier, city, state, lat, lng, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT(email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        avatar_url = EXCLUDED.avatar_url,
        bio        = EXCLUDED.bio,
        company    = EXCLUDED.company,
        tier       = EXCLUDED.tier,
        city       = EXCLUDED.city,
        state      = EXCLUDED.state,
        lat        = EXCLUDED.lat,
        lng        = EXCLUDED.lng,
        updated_at = NOW()`,
      values,
    );
    return;
  }

  const db = getSqliteDb();
  db.run(
    `INSERT INTO manual_coaches (
      email, first_name, last_name, avatar_url, bio, company, tier, city, state, lat, lng, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(email) DO UPDATE SET
      first_name = excluded.first_name,
      last_name  = excluded.last_name,
      avatar_url = excluded.avatar_url,
      bio        = excluded.bio,
      company    = excluded.company,
      tier       = excluded.tier,
      city       = excluded.city,
      state      = excluded.state,
      lat        = excluded.lat,
      lng        = excluded.lng,
      updated_at = CURRENT_TIMESTAMP`,
    values,
  );
}

export async function deleteManualCoach(email: string): Promise<void> {
  await ensureDbSchema();
  const normalized = email.trim().toLowerCase();
  if (isPostgresDb) {
    await requirePgPool().query(
      `DELETE FROM manual_coaches WHERE lower(email) = $1`,
      [normalized],
    );
    return;
  }
  getSqliteDb().run(`DELETE FROM manual_coaches WHERE email = ? COLLATE NOCASE`, [
    normalized,
  ]);
}
