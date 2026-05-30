import { Database } from "bun:sqlite";
import { env } from "../env";

let instance: Database | null = null;

/**
 * Lazy sqlite handle. Opening is deferred so PG-mode deploys never touch the
 * filesystem (no stray empty sqlite file). All sqlite call sites go through
 * this — direct `new Database(...)` would re-introduce the eager-open.
 */
export function getSqliteDb(): Database {
  if (!instance) {
    instance = new Database(env.coachDataDbPath, { create: true });

    // WAL lets readers and a single writer proceed in parallel. Single-process
    // API today, so this is pure upside: fewer "database is locked" surprises
    // during the startup cache warm + first request burst.
    instance.exec("PRAGMA journal_mode = WAL;");
    instance.exec("PRAGMA foreign_keys = ON;");
  }
  return instance;
}
