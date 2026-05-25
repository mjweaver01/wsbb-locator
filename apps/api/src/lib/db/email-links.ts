import { db } from "./db";

export interface CoachEmailLink {
  thinkificUserId: number;
  email: string;
  source: string;
  createdAt: string;
}

interface CoachEmailLinkRow {
  thinkific_user_id: number;
  email: string;
  source: string;
  created_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS coach_email_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_coach_email_links_thinkific_user_id
  ON coach_email_links(thinkific_user_id);
`);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toCoachEmailLink(row: CoachEmailLinkRow): CoachEmailLink {
  return {
    thinkificUserId: row.thinkific_user_id,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function listCoachEmailLinks(thinkificUserId: number): CoachEmailLink[] {
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

export function upsertCoachEmailLink(
  thinkificUserId: number,
  email: string,
  source = "manual",
): CoachEmailLink {
  const normalizedEmail = normalizeEmail(email);
  const normalizedSource = source.trim() || "manual";

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

export function deleteCoachEmailLink(
  thinkificUserId: number,
  email: string,
): boolean {
  const normalizedEmail = normalizeEmail(email);
  const result = db.run(
    `DELETE FROM coach_email_links
     WHERE thinkific_user_id = ? AND email = ?`,
    [thinkificUserId, normalizedEmail],
  );
  return result.changes > 0;
}

export function findThinkificUserIdByLinkedEmail(email: string): number | null {
  const normalizedEmail = normalizeEmail(email);
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
