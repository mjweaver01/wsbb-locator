import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { db } from "./db";
import { getPgPool } from "./pg";

interface CoachSessionRow {
  thinkific_user_id: number | string;
  expires_at: string;
}

const pgPool = getPgPool();
let pgInitPromise: Promise<void> | null = null;

if (!pgPool) {
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

    CREATE INDEX IF NOT EXISTS idx_coach_login_codes_lookup
    ON coach_login_codes(thinkific_user_id, email, created_at DESC);

    CREATE TABLE IF NOT EXISTS coach_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thinkific_user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function ensurePgAuthTables(): Promise<void> {
  if (!pgPool) return;
  if (pgInitPromise) return pgInitPromise;
  pgInitPromise = pgPool
    .query(`
      CREATE TABLE IF NOT EXISTS coach_login_codes (
        id BIGSERIAL PRIMARY KEY,
        thinkific_user_id BIGINT NOT NULL,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_coach_login_codes_lookup
      ON coach_login_codes(thinkific_user_id, lower(email), created_at DESC);
      CREATE TABLE IF NOT EXISTS coach_sessions (
        id BIGSERIAL PRIMARY KEY,
        thinkific_user_id BIGINT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
    .then(() => undefined);
  return pgInitPromise ?? Promise.resolve();
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

  if (pgPool) {
    await ensurePgAuthTables();
    await pgPool.query(
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
  if (pgPool) {
    await ensurePgAuthTables();
    const result = await pgPool.query<
      { id: number | string; code_hash: string; expires_at: string }
    >(
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

    await pgPool.query(
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

  if (pgPool) {
    await ensurePgAuthTables();
    await pgPool.query(
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
  if (pgPool) {
    await ensurePgAuthTables();
    const result = await pgPool.query<CoachSessionRow>(
      `SELECT thinkific_user_id, expires_at
       FROM coach_sessions
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (Date.parse(row.expires_at) <= nowMs()) return null;

    await pgPool.query(
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
  if (pgPool) {
    await ensurePgAuthTables();
    await pgPool.query(`DELETE FROM coach_sessions WHERE token_hash = $1`, [
      tokenHash,
    ]);
    return;
  }
  db.run(`DELETE FROM coach_sessions WHERE token_hash = ?`, [tokenHash]);
}
