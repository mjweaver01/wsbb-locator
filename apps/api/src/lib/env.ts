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

function readOptionalIntEnv(name: string): number | undefined {
  const raw = readEnv(name);
  if (!raw) return undefined;

  // Treat placeholder-looking values as unset, so deployment doesn't crash.
  if (raw.startsWith("<") && raw.endsWith(">")) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

function readIntEnvWithDefault(name: string, fallback: number): number {
  return readIntEnv(name) ?? fallback;
}

function readBoolEnvWithDefault(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(`${name} must be a boolean (true/false). Received "${raw}".`);
}

function readCsvEnv(name: string): string[] {
  const raw = readEnv(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const configuredCorsOrigins = readCsvEnv("CORS_ALLOWED_ORIGINS");
const isProduction = readEnv("NODE_ENV") === "production";

export const env = {
  port: readIntEnvWithDefault("PORT", 3001),
  coachCacheTtlMs: readIntEnvWithDefault("COACH_CACHE_TTL_MS", 60 * 60 * 1000),
  coachDataDbPath:
    readEnv("COACH_DATA_DB_PATH") ??
    readEnv("COACH_OVERRIDES_DB_PATH") ??
    `${import.meta.dir}/../../data/coach-data.sqlite`,
  coachAuthCodeTtlMinutes: readIntEnvWithDefault(
    "COACH_AUTH_CODE_TTL_MINUTES",
    15,
  ),
  coachSessionTtlDays: readIntEnvWithDefault("COACH_SESSION_TTL_DAYS", 30),
  coachAuthCookieName:
    readEnv("COACH_AUTH_COOKIE_NAME") ?? "wsbb_coach_session",
  coachAuthCookieSecure: readBoolEnvWithDefault(
    "COACH_AUTH_COOKIE_SECURE",
    isProduction,
  ),
  coachAuthRequestRateLimitMax: readIntEnvWithDefault(
    "COACH_AUTH_REQUEST_RATE_LIMIT_MAX",
    10,
  ),
  coachAuthRequestRateLimitWindowMs: readIntEnvWithDefault(
    "COACH_AUTH_REQUEST_RATE_LIMIT_WINDOW_MS",
    10 * 60 * 1000,
  ),
  coachAuthVerifyRateLimitMax: readIntEnvWithDefault(
    "COACH_AUTH_VERIFY_RATE_LIMIT_MAX",
    20,
  ),
  coachAuthVerifyRateLimitWindowMs: readIntEnvWithDefault(
    "COACH_AUTH_VERIFY_RATE_LIMIT_WINDOW_MS",
    10 * 60 * 1000,
  ),
  coachAuthDebugExposeCode: readBoolEnvWithDefault(
    "COACH_AUTH_DEBUG_EXPOSE_CODE",
    false,
  ),
  corsAllowedOrigins: configuredCorsOrigins,
  corsEnforceAllowlist: readBoolEnvWithDefault(
    "CORS_ENFORCE_ALLOWLIST",
    isProduction,
  ),
  coachAdminApiKey: readEnv("COACH_ADMIN_API_KEY"),
  emailProvider: (readEnv("EMAIL_PROVIDER") ?? "console").toLowerCase(),
  emailFrom: readEnv("EMAIL_FROM"),
  resendApiKey: readEnv("RESEND_API_KEY"),
  thinkificApiKey: readEnv("THINKIFIC_API_KEY"),
  thinkificSubdomain: readEnv("THINKIFIC_SUBDOMAIN"),
  thinkificLevel1Id: readOptionalIntEnv("THINKIFIC_LEVEL1_ID"),
  thinkificLevel2Id: readOptionalIntEnv("THINKIFIC_LEVEL2_ID"),
  thinkificLevel3Id: readOptionalIntEnv("THINKIFIC_LEVEL3_ID"),
  thinkificRateLimitMs: readIntEnvWithDefault("THINKIFIC_RATE_LIMIT_MS", 500),
  webDistPath:
    readEnv("WEB_DIST_PATH") ?? `${import.meta.dir}/../../../web/dist`,
  serveStatic: readBoolEnvWithDefault("SERVE_STATIC", isProduction),
} as const;
