import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db";

interface CoachSessionRow {
  thinkific_user_id: number;
  expires_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS coach_login_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_coach_login_codes_lookup
  ON coach_login_codes(thinkific_user_id, email, created_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS coach_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thinkific_user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowMs(): number {
  return Date.now();
}

function addMinutes(isoDateMs: number, minutes: number): string {
  return new Date(isoDateMs + minutes * 60 * 1000).toISOString();
}

function addDays(isoDateMs: number, days: number): string {
  return new Date(isoDateMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function createLoginCode(
  thinkificUserId: number,
  email: string,
  ttlMinutes: number,
): string {
  const normalizedEmail = normalizeEmail(email);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = hashString(code);
  const expiresAt = addMinutes(nowMs(), ttlMinutes);

  db.run(
    `INSERT INTO coach_login_codes (
      thinkific_user_id, email, code_hash, expires_at
    ) VALUES (?, ?, ?, ?)`,
    [thinkificUserId, normalizedEmail, codeHash, expiresAt],
  );

  return code;
}

export function verifyAndConsumeLoginCode(
  thinkificUserId: number,
  email: string,
  submittedCode: string,
): boolean {
  const normalizedEmail = normalizeEmail(email);
  const row = db
    .query<
      { id: number; code_hash: string; expires_at: string },
      [number, string]
    >(
      `SELECT id, code_hash, expires_at
       FROM coach_login_codes
       WHERE thinkific_user_id = ? AND email = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(thinkificUserId, normalizedEmail);

  if (!row) return false;
  if (Date.parse(row.expires_at) <= nowMs()) return false;

  const submittedHash = hashString(submittedCode.trim());
  const ok = timingSafeEqual(
    Buffer.from(submittedHash, "utf8"),
    Buffer.from(row.code_hash, "utf8"),
  );
  if (!ok) return false;

  db.run(
    `UPDATE coach_login_codes
     SET used_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [row.id],
  );
  return true;
}

export function createCoachSession(
  thinkificUserId: number,
  ttlDays: number,
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashString(token);
  const expiresAt = addDays(nowMs(), ttlDays);

  db.run(
    `INSERT INTO coach_sessions (thinkific_user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [thinkificUserId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

export function getCoachSession(
  token: string,
): { thinkificUserId: number } | null {
  const tokenHash = hashString(token);
  const row = db
    .query<CoachSessionRow, [string]>(
      `SELECT thinkific_user_id, expires_at
       FROM coach_sessions
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .get(tokenHash);

  if (!row) return null;
  if (Date.parse(row.expires_at) <= nowMs()) return null;

  db.run(
    `UPDATE coach_sessions
     SET last_seen_at = CURRENT_TIMESTAMP
     WHERE token_hash = ?`,
    [tokenHash],
  );

  return { thinkificUserId: row.thinkific_user_id };
}

export function deleteCoachSession(token: string): void {
  const tokenHash = hashString(token);
  db.run(`DELETE FROM coach_sessions WHERE token_hash = ?`, [tokenHash]);
}
