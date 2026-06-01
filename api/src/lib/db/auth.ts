import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { getSqliteDb } from "./db";
import { requirePgPool } from "./pg";
import { ensureDbSchema, isPostgresDb } from "./schema";
import { normalizeEmail } from "../normalize-email";

interface CoachSessionRow {
  thinkific_user_id: number | string;
  expires_at: string;
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

  const db = getSqliteDb();
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
    // `id DESC` breaks ties when `created_at` lands in the same timestamp bucket.
    const result = await requirePgPool().query<{
      id: number | string;
      code_hash: string;
      expires_at: string;
    }>(
      `SELECT id, code_hash, expires_at
       FROM coach_login_codes
       WHERE thinkific_user_id = $1 AND lower(email) = lower($2) AND used_at IS NULL
       ORDER BY created_at DESC, id DESC
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

  // Mirror Postgres ordering so "latest code wins" is deterministic in sqlite too.
  const db = getSqliteDb();
  const row = db
    .query<
      { id: number; code_hash: string; expires_at: string },
      [number, string]
    >(
      `SELECT id, code_hash, expires_at
       FROM coach_login_codes
       WHERE thinkific_user_id = ? AND email = ? AND used_at IS NULL
       ORDER BY created_at DESC, id DESC
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

  const db = getSqliteDb();
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

  const db = getSqliteDb();
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
  const db = getSqliteDb();
  db.run(`DELETE FROM coach_sessions WHERE token_hash = ?`, [tokenHash]);
}

/**
 * Delete auth rows that can never be used again: expired sessions, and login
 * codes that are either expired or already consumed. Both reads already reject
 * these rows at request time — this just stops them accumulating forever in a
 * long-lived process. `expires_at` is always written as a UTC ISO-8601 string
 * (see addMinutes/addDays), so the lexicographic sqlite comparison is sound.
 */
export async function purgeExpiredAuthRows(): Promise<void> {
  await ensureDbSchema();
  if (isPostgresDb) {
    const pool = requirePgPool();
    await pool.query(`DELETE FROM coach_sessions WHERE expires_at <= NOW()`);
    await pool.query(
      `DELETE FROM coach_login_codes WHERE expires_at <= NOW() OR used_at IS NOT NULL`,
    );
    return;
  }

  const nowIso = new Date(nowMs()).toISOString();
  const db = getSqliteDb();
  db.run(`DELETE FROM coach_sessions WHERE expires_at <= ?`, [nowIso]);
  db.run(
    `DELETE FROM coach_login_codes WHERE expires_at <= ? OR used_at IS NOT NULL`,
    [nowIso],
  );
}

/**
 * Run {@link purgeExpiredAuthRows} on an interval. Mirrors the rate-limit
 * sweeper: fire-and-forget, unref'd so it never keeps the process alive, and
 * runs once immediately so a freshly started instance cleans up prior rows.
 * Returns a stop handle.
 */
export function startAuthGcSweeper(intervalMs: number): () => void {
  const run = () => {
    purgeExpiredAuthRows().catch((err) => {
      console.error("[auth-gc] purge failed:", (err as Error).message);
    });
  };

  run();
  const interval = setInterval(run, intervalMs);
  if (
    typeof interval === "object" &&
    interval !== null &&
    "unref" in interval
  ) {
    (interval as { unref: () => void }).unref();
  }
  return () => clearInterval(interval);
}
