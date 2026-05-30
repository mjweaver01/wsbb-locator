import { Pool } from "pg";
import { env } from "../env";

let pool: Pool | null = null;

export function getPgPool(): Pool | null {
  if (!env.databaseUrl) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseUrl.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
    });
  }
  return pool;
}

/**
 * Returns the Postgres pool, throwing if it's unavailable. Call sites in the
 * DB layer use this only on the `isPostgresDb` branch, where the pool is
 * guaranteed to exist.
 */
export function requirePgPool(): Pool {
  const pool = getPgPool();
  if (!pool) {
    throw new Error("Postgres pool unavailable in postgres mode.");
  }
  return pool;
}
