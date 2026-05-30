import type { Coach, CoachesPayload, RawCertification } from "@shared/coach";
import { recalculateTierBreakdown } from "../thinkific";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { ensureDbSchema, isPostgresDb } from "./schema";

interface ThinkificCacheCoachRow {
  thinkific_user_id: number | string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  tier: "certified" | "instructor" | "master";
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  certifications_json: string;
}

interface ThinkificCacheMetaRow {
  fetched_at: string;
  subdomain: string;
}

/**
 * Defensively parse the stored certifications JSON. A single corrupt row must
 * not crash the entire coaches load, so a bad value degrades to an empty list.
 */
function parseCertifications(
  json: string,
  thinkificUserId: number | string,
): RawCertification[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RawCertification[]) : [];
  } catch {
    console.error(
      `[thinkific-cache] corrupt certifications_json for coach ${thinkificUserId}; defaulting to []`,
    );
    return [];
  }
}

export async function saveThinkificCache(
  payload: CoachesPayload,
): Promise<void> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const client = await requirePgPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM thinkific_coaches_cache`);
      await client.query(`DELETE FROM thinkific_cache_meta WHERE id = 1`);
      for (const coach of payload.coaches) {
        await client.query(
          `INSERT INTO thinkific_coaches_cache (
            thinkific_user_id, email, first_name, last_name, full_name, avatar_url,
            bio, tier, city, state, lat, lng, certifications_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            coach.thinkificUserId,
            coach.email,
            coach.firstName,
            coach.lastName,
            coach.fullName,
            coach.avatarUrl ?? null,
            coach.bio ?? null,
            coach.tier,
            coach.city ?? null,
            coach.state ?? null,
            coach.lat ?? null,
            coach.lng ?? null,
            JSON.stringify(coach.certifications),
          ],
        );
      }
      await client.query(
        `INSERT INTO thinkific_cache_meta (id, fetched_at, subdomain, synced_at)
         VALUES (1, $1::timestamptz, $2, NOW())`,
        [payload.fetchedAt, payload.subdomain],
      );
      await client.query("COMMIT");
      return;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  const db = getSqliteDb();
  const write = db.transaction((data: CoachesPayload) => {
    db.run(`DELETE FROM thinkific_coaches_cache`);
    db.run(`DELETE FROM thinkific_cache_meta WHERE id = 1`);

    const insertCoach = db.prepare(
      `INSERT INTO thinkific_coaches_cache (
        thinkific_user_id, email, first_name, last_name, full_name, avatar_url,
        bio, tier, city, state, lat, lng, certifications_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const coach of data.coaches) {
      insertCoach.run(
        coach.thinkificUserId,
        coach.email,
        coach.firstName,
        coach.lastName,
        coach.fullName,
        coach.avatarUrl ?? null,
        coach.bio ?? null,
        coach.tier,
        coach.city ?? null,
        coach.state ?? null,
        coach.lat ?? null,
        coach.lng ?? null,
        JSON.stringify(coach.certifications),
      );
    }

    db.run(
      `INSERT INTO thinkific_cache_meta (id, fetched_at, subdomain, synced_at)
       VALUES (1, ?, ?, CURRENT_TIMESTAMP)`,
      [data.fetchedAt, data.subdomain],
    );
  });

  write(payload);
}

export async function loadThinkificCache(): Promise<CoachesPayload | null> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const metaResult = await requirePgPool().query<ThinkificCacheMetaRow>(
      `SELECT fetched_at, subdomain FROM thinkific_cache_meta WHERE id = 1`,
    );
    const meta = metaResult.rows[0];
    if (!meta) return null;

    const rowsResult = await requirePgPool().query<ThinkificCacheCoachRow>(
      `SELECT
        thinkific_user_id, email, first_name, last_name, full_name, avatar_url, bio, tier,
        city, state, lat, lng, certifications_json
       FROM thinkific_coaches_cache
       ORDER BY tier DESC, full_name ASC`,
    );

    const coaches: Coach[] = rowsResult.rows.map((row) => ({
      thinkificUserId: Number(row.thinkific_user_id),
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      // `company` is only used during the live fetch (for geocoding) and isn't
      // persisted in the cache table, so it's unknown when loading from cache.
      company: null,
      tier: row.tier,
      ...(row.city !== null ? { city: row.city } : {}),
      ...(row.state !== null ? { state: row.state } : {}),
      ...(row.lat !== null ? { lat: row.lat } : {}),
      ...(row.lng !== null ? { lng: row.lng } : {}),
      certifications: parseCertifications(
        row.certifications_json,
        row.thinkific_user_id,
      ),
    }));

    return {
      fetchedAt: meta.fetched_at,
      subdomain: meta.subdomain,
      totalCoaches: coaches.length,
      tierBreakdown: recalculateTierBreakdown(coaches),
      coaches,
    };
  }

  const db = getSqliteDb();
  const meta = db
    .query<
      ThinkificCacheMetaRow,
      []
    >(`SELECT fetched_at, subdomain FROM thinkific_cache_meta WHERE id = 1`)
    .get();

  if (!meta) return null;

  const rows = db
    .query<ThinkificCacheCoachRow, []>(
      `SELECT
        thinkific_user_id, email, first_name, last_name, full_name, avatar_url, bio, tier,
        city, state, lat, lng, certifications_json
       FROM thinkific_coaches_cache
       ORDER BY tier DESC, full_name ASC`,
    )
    .all();

  const coaches: Coach[] = rows.map((row) => ({
    thinkificUserId: Number(row.thinkific_user_id),
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    company: null,
    tier: row.tier,
    ...(row.city !== null ? { city: row.city } : {}),
    ...(row.state !== null ? { state: row.state } : {}),
    ...(row.lat !== null ? { lat: row.lat } : {}),
    ...(row.lng !== null ? { lng: row.lng } : {}),
    certifications: parseCertifications(
      row.certifications_json,
      row.thinkific_user_id,
    ),
  }));

  return {
    fetchedAt: meta.fetched_at,
    subdomain: meta.subdomain,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
    coaches,
  };
}
