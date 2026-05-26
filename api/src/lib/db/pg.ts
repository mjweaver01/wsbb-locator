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
