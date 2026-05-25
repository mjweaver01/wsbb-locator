function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readIntEnv(name: string): number | undefined {
  const raw = readEnv(name);
  if (!raw) return undefined;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer. Received "${raw}".`);
  }

  return parsed;
}

function readIntEnvWithDefault(name: string, fallback: number): number {
  return readIntEnv(name) ?? fallback;
}

export const env = {
  port: readIntEnvWithDefault("PORT", 3001),
  coachCacheTtlMs: readIntEnvWithDefault("COACH_CACHE_TTL_MS", 60 * 60 * 1000),
  databaseUrl: readEnv("DATABASE_URL") ?? "file:./dev.db",
  thinkificApiKey: readEnv("THINKIFIC_API_KEY"),
  thinkificSubdomain: readEnv("THINKIFIC_SUBDOMAIN"),
  thinkificLevel1Id: readIntEnv("THINKIFIC_LEVEL1_ID"),
  thinkificLevel2Id: readIntEnv("THINKIFIC_LEVEL2_ID"),
  thinkificLevel3Id: readIntEnv("THINKIFIC_LEVEL3_ID"),
} as const;
