import { Database } from "bun:sqlite";
import { env } from "../env";

export const db = new Database(env.coachDataDbPath, { create: true });
