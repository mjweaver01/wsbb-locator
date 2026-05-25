import { Database } from "bun:sqlite";
import { env } from "../env";

export const db = new Database(env.coachDataDbPath, { create: true });

// WAL lets readers and a single writer proceed in parallel. We're already
// a single-process API, so this is pure upside: fewer "database is locked"
// surprises during the startup cache warm + first request burst.
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
