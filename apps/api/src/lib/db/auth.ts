import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { db } from "./db";
import { getPgPool } from "./pg";
import { ensureDbSchema, isPostgresDb } from "./schema";

interface CoachSessionRow {
  thinkific_user_id: number | string;
  expires_at: string;
}

const pgPool = getPgPool();

function requirePgPool() {
  if (!pgPool) {
    throw new Error("Postgres pool unavailable in postgres mode.");
  }
  return pgPool;
}

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

export async function createLoginCode(
  thinkificUserId: number,
  email: string,
  ttlMinutes: number,
): Promise<string> {
  const normalizedEmail = normalizeEmail(email);
  const code = String(randomInt(100000, 1000000));
  const codeHash = hashString(code);
  const expiresAt = addMinutes(nowMs(), ttlMinutes);

  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
      `INSERT INTO coach_login_codes (
        thinkific_user_id, email, code_hash, expires_at
      ) VALUES ($1, $2, $3, $4::timestamptz)`,
      [thinkificUserId, normalizedEmail, codeHash, expiresAt],
    );
    return code;
  }

  db.run(
    `INSERT INTO coach_login_codes (
      thinkific_user_id, email, code_hash, expires_at
    ) VALUES (?, ?, ?, ?)`,
    [thinkificUserId, normalizedEmail, codeHash, expiresAt],
  );

  return code;
}

export async function verifyAndConsumeLoginCode(
  thinkificUserId: number,
  email: string,
  submittedCode: string,
): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<{
      id: number | string;
      code_hash: string;
      expires_at: string;
    }>(
      `SELECT id, code_hash, expires_at
       FROM coach_login_codes
       WHERE thinkific_user_id = $1 AND lower(email) = lower($2) AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [thinkificUserId, normalizedEmail],
    );
    const row = result.rows[0];
    if (!row) return false;
    if (Date.parse(row.expires_at) <= nowMs()) return false;

    const submittedHash = hashString(submittedCode.trim());
    const submittedBuf = Buffer.from(submittedHash, "utf8");
    const storedBuf = Buffer.from(row.code_hash, "utf8");
    if (submittedBuf.length !== storedBuf.length) return false;
    if (!timingSafeEqual(submittedBuf, storedBuf)) return false;

    await requirePgPool().query(
      `UPDATE coach_login_codes
       SET used_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
    return true;
  }

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
  const submittedBuf = Buffer.from(submittedHash, "utf8");
  const storedBuf = Buffer.from(row.code_hash, "utf8");
  if (submittedBuf.length !== storedBuf.length) return false;
  if (!timingSafeEqual(submittedBuf, storedBuf)) return false;

  db.run(
    `UPDATE coach_login_codes
     SET used_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [row.id],
  );
  return true;
}

export async function createCoachSession(
  thinkificUserId: number,
  ttlDays: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashString(token);
  const expiresAt = addDays(nowMs(), ttlDays);

  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
      `INSERT INTO coach_sessions (thinkific_user_id, token_hash, expires_at)
       VALUES ($1, $2, $3::timestamptz)`,
      [thinkificUserId, tokenHash, expiresAt],
    );
    return { token, expiresAt };
  }

  db.run(
    `INSERT INTO coach_sessions (thinkific_user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [thinkificUserId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

export async function getCoachSession(
  token: string,
): Promise<{ thinkificUserId: number } | null> {
  const tokenHash = hashString(token);
  await ensureDbSchema();
  if (isPostgresDb) {
    const result = await requirePgPool().query<CoachSessionRow>(
      `SELECT thinkific_user_id, expires_at
       FROM coach_sessions
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (Date.parse(row.expires_at) <= nowMs()) return null;

    await requirePgPool().query(
      `UPDATE coach_sessions
       SET last_seen_at = NOW()
       WHERE token_hash = $1`,
      [tokenHash],
    );

    return { thinkificUserId: Number(row.thinkific_user_id) };
  }

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

  return { thinkificUserId: Number(row.thinkific_user_id) };
}

export async function deleteCoachSession(token: string): Promise<void> {
  const tokenHash = hashString(token);
  await ensureDbSchema();
  if (isPostgresDb) {
    await requirePgPool().query(
      `DELETE FROM coach_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    return;
  }
  db.run(`DELETE FROM coach_sessions WHERE token_hash = ?`, [tokenHash]);
}
