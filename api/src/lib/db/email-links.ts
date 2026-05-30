import type { CoachEmailLink } from "@shared/coach";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { ensureDbSchema, isPostgresDb } from "./schema";
import { normalizeEmail } from "../normalize-email";

export type { CoachEmailLink };

interface CoachEmailLinkRow {
  thinkific_user_id: number | string;
  email: string;
  source: string;
  created_at: string;
}

function toCoachEmailLink(row: CoachEmailLinkRow): CoachEmailLink {
  return {
    thinkificUserId: Number(row.thinkific_user_id),
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
  };
}

export async function listCoachEmailLinks(
  thinkificUserId: number,
): Promise<CoachEmailLink[]> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachEmailLinkRow>(
      `SELECT thinkific_user_id, email, source, created_at
       FROM coach_email_links
       WHERE thinkific_user_id = $1
       ORDER BY created_at DESC`,
      [thinkificUserId],
    );
    return result.rows.map(toCoachEmailLink);
  }

  const db = getSqliteDb();
  const rows = db
    .query<CoachEmailLinkRow, [number]>(
      `SELECT thinkific_user_id, email, source, created_at
       FROM coach_email_links
       WHERE thinkific_user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(thinkificUserId);

  return rows.map(toCoachEmailLink);
}

export async function upsertCoachEmailLink(
  thinkificUserId: number,
  email: string,
  source = "manual",
): Promise<CoachEmailLink> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedSource = source.trim() || "manual";

  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachEmailLinkRow>(
      `INSERT INTO coach_email_links (thinkific_user_id, email, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         thinkific_user_id = EXCLUDED.thinkific_user_id,
         source = EXCLUDED.source
       RETURNING thinkific_user_id, email, source, created_at`,
      [thinkificUserId, normalizedEmail, normalizedSource],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to load upserted coach email link.");
    }
    return toCoachEmailLink(row);
  }

  const db = getSqliteDb();
  db.run(
    `INSERT INTO coach_email_links (thinkific_user_id, email, source)
     VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       thinkific_user_id = excluded.thinkific_user_id,
       source = excluded.source`,
    [thinkificUserId, normalizedEmail, normalizedSource],
  );

  const row = db
    .query<CoachEmailLinkRow, [string]>(
      `SELECT thinkific_user_id, email, source, created_at
       FROM coach_email_links
       WHERE email = ?`,
    )
    .get(normalizedEmail);

  if (!row) {
    throw new Error("Failed to load upserted coach email link.");
  }

  return toCoachEmailLink(row);
}

export async function deleteCoachEmailLink(
  thinkificUserId: number,
  email: string,
): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query(
      `DELETE FROM coach_email_links
       WHERE thinkific_user_id = $1 AND lower(email) = lower($2)`,
      [thinkificUserId, normalizedEmail],
    );
    return (result.rowCount ?? 0) > 0;
  }

  const db = getSqliteDb();
  const result = db.run(
    `DELETE FROM coach_email_links
     WHERE thinkific_user_id = ? AND email = ?`,
    [thinkificUserId, normalizedEmail],
  );
  return result.changes > 0;
}

export async function findThinkificUserIdByLinkedEmail(
  email: string,
): Promise<number | null> {
  const normalizedEmail = normalizeEmail(email);
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<{
      thinkific_user_id: number | string;
    }>(
      `SELECT thinkific_user_id
       FROM coach_email_links
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [normalizedEmail],
    );
    const row = result.rows[0];
    return row ? Number(row.thinkific_user_id) : null;
  }

  const db = getSqliteDb();
  const row = db
    .query<{ thinkific_user_id: number }, [string]>(
      `SELECT thinkific_user_id
       FROM coach_email_links
       WHERE email = ?
       LIMIT 1`,
    )
    .get(normalizedEmail);

  return row?.thinkific_user_id ?? null;
}
