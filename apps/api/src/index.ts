import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { resolve } from "path";
import {
  fetchCoachesFromThinkific,
  recalculateTierBreakdown,
  type Coach,
  type CoachesPayload,
} from "./lib/thinkific";
import { env } from "./lib/env";
import {
  coachOverridesDbDriver,
  deleteCoachOverride,
  getCoachOverride,
  listCoachOverrides,
  upsertCoachOverride,
  type CoachOverride,
} from "./lib/db/overrides";
import {
  loadThinkificCache,
  saveThinkificCache,
} from "./lib/db/thinkific-cache";
import {
  deleteCoachEmailLink,
  findThinkificUserIdByLinkedEmail,
  listCoachEmailLinks,
  upsertCoachEmailLink,
} from "./lib/db/email-links";
import {
  createCoachSession,
  createLoginCode,
  deleteCoachSession,
  getCoachSession,
  verifyAndConsumeLoginCode,
} from "./lib/db/auth";
import { sendCoachLoginCode } from "./lib/email";
import { requireAdminApiKey } from "./lib/admin-auth";
import {
  parseCoachOverride,
  readOptionalStringField,
  readRequiredCodeField,
  readRequiredEmailField,
} from "./lib/request-validation";
import { checkRateLimit, startRateLimitSweeper } from "./lib/rate-limit";
import { getClientIp, parseIntParam, withJsonBody } from "./lib/http";
import { serveStaticSpa } from "./lib/static";
import {
  buildCoachMediaFilename,
  coachMediaStorageMode,
  deleteCoachMedia,
  readCoachMedia,
  saveCoachMedia,
} from "./lib/coach-media";

const STATIC_FALLBACK_PATH = resolve(
  import.meta.dir,
  "../data/coaches-raw.json",
);
const COACH_MEDIA_ROUTE_PREFIX = "/api/coach-media/";
const SAFE_MEDIA_FILENAME = /^[A-Za-z0-9._-]+$/;
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SAFE_OVERRIDE_KEYS = [
  "bio",
  "avatarUrl",
  "city",
  "state",
  "lat",
  "lng",
] as const satisfies readonly (keyof CoachOverride)[];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: CoachesPayload | null = null;
let cacheSetAt = 0;

function isCacheStale() {
  return !cache || Date.now() - cacheSetAt > env.coachCacheTtlMs;
}

function invalidateCache() {
  cache = null;
  cacheSetAt = 0;
}

function loadStaticFallback(): Promise<CoachesPayload> {
  return Bun.file(STATIC_FALLBACK_PATH).json() as Promise<CoachesPayload>;
}

/**
 * Apply local overrides to Thinkific data. Only fields in SAFE_OVERRIDE_KEYS
 * are merged in — identity columns (id/email/name/tier/certifications) always
 * come from Thinkific, even if a malformed override row contains them.
 */
async function mergeCoachOverrides(data: CoachesPayload): Promise<CoachesPayload> {
  const overridesById = await listCoachOverrides();
  const coaches = data.coaches.map((coach) => {
    const override = overridesById[String(coach.thinkificUserId)];
    if (!override) return coach;
    const merged: Coach = { ...coach };
    for (const key of SAFE_OVERRIDE_KEYS) {
      const value = override[key];
      if (value !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  });

  return {
    ...data,
    coaches,
    totalCoaches: coaches.length,
    tierBreakdown: recalculateTierBreakdown(coaches),
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function buildCoachMediaUrl(c: Context, filename: string): string {
  return new URL(`${COACH_MEDIA_ROUTE_PREFIX}${filename}`, c.req.url).toString();
}

function resolveManagedCoachMediaFilename(avatarUrl: string): string | null {
  try {
    const parsed = new URL(avatarUrl);
    if (!parsed.pathname.startsWith(COACH_MEDIA_ROUTE_PREFIX)) return null;
    const candidate = parsed.pathname.slice(COACH_MEDIA_ROUTE_PREFIX.length);
    return SAFE_MEDIA_FILENAME.test(candidate) ? candidate : null;
  } catch {
    if (!avatarUrl.startsWith(COACH_MEDIA_ROUTE_PREFIX)) return null;
    const candidate = avatarUrl.slice(COACH_MEDIA_ROUTE_PREFIX.length);
    return SAFE_MEDIA_FILENAME.test(candidate) ? candidate : null;
  }
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

function setSessionCookie(c: Context, token: string, expiresAt: string): void {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  setCookie(c, env.coachAuthCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: maxAgeSeconds,
    secure: env.coachAuthCookieSecure,
  });
}

function clearSessionCookie(c: Context): void {
  deleteCookie(c, env.coachAuthCookieName, {
    path: "/",
    secure: env.coachAuthCookieSecure,
  });
}

async function getAuthenticatedThinkificUserId(c: Context): Promise<number | null> {
  const token = getCookie(c, env.coachAuthCookieName);
  if (!token) return null;
  return (await getCoachSession(token))?.thinkificUserId ?? null;
}

async function resolveCoachByEmail(email: string): Promise<{
  thinkificUserId: number;
  source: "thinkific-email" | "linked-email";
}> {
  const normalizedEmail = normalizeEmail(email);
  const { data } = await getCoaches();

  const direct = data.coaches.find(
    (coach) => normalizeEmail(coach.email) === normalizedEmail,
  );
  if (direct) {
    return {
      thinkificUserId: direct.thinkificUserId,
      source: "thinkific-email",
    };
  }

  const linkedId = await findThinkificUserIdByLinkedEmail(normalizedEmail);
  if (linkedId) {
    return { thinkificUserId: linkedId, source: "linked-email" };
  }

  throw new Error("Coach not found");
}

async function getCoaches(): Promise<{ data: CoachesPayload; source: string }> {
  if (!isCacheStale()) {
    return { data: cache!, source: "cache" };
  }

  try {
    const cached = await loadThinkificCache();
    if (cached) {
      const data = await mergeCoachOverrides(cached);
      cache = data;
      cacheSetAt = Date.now();
      console.log(
        `[db-cache] loaded ${data.totalCoaches} coaches from thinkific cache table`,
      );
      return { data, source: "db-cache" };
    }
  } catch (err) {
    console.error(
      "[db-cache] load failed, trying thinkific/static fallback:",
      (err as Error).message,
    );
  }

  const hasThinkificCreds = env.thinkificApiKey && env.thinkificSubdomain;

  if (hasThinkificCreds) {
    try {
      console.log("[thinkific] db cache empty, fetching live data...");
      const thinkificData = await fetchCoachesFromThinkific();
      await saveThinkificCache(thinkificData);
      const data = await mergeCoachOverrides(thinkificData);
      cache = data;
      cacheSetAt = Date.now();
      console.log(`[thinkific] cached ${data.totalCoaches} coaches`);
      return { data, source: "thinkific" };
    } catch (err) {
      console.error(
        "[thinkific] fetch failed, falling back to static JSON:",
        (err as Error).message,
      );
    }
  }

  try {
    const data = await mergeCoachOverrides(await loadStaticFallback());
    cache = data;
    cacheSetAt = Date.now();
    console.log(
      `[static] loaded ${data.totalCoaches} coaches from coaches-raw.json`,
    );
    return { data, source: "static" };
  } catch (err) {
    throw new Error(`No coach data available: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------

const app = new Hono();

app.use(
  "*",
  secureHeaders({
    // Leaflet pulls tiles from carto + osm and we render avatar URLs from
    // arbitrary https hosts (Thinkific CDN, customer-supplied avatarUrl).
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://*.basemaps.cartocdn.com"],
      fontSrc: ["'self'", "data:"],
    },
    strictTransportSecurity: env.coachAuthCookieSecure
      ? "max-age=31536000; includeSubDomains"
      : false,
  }),
);

// CORS is only useful in dev (Vite at :5173 → API at :3001) and any cross-origin
// embed scenario. In single-origin prod (SERVE_STATIC=true) browsers won't even
// emit Origin for same-origin requests, so this becomes a no-op anyway.
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (!env.corsEnforceAllowlist) return origin;
      return env.corsAllowedOrigins.includes(origin) ? origin : "";
    },
    credentials: true,
  }),
);

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    cachedAt: cache ? new Date(cacheSetAt).toISOString() : null,
    totalCoaches: cache?.totalCoaches ?? 0,
  }),
);

app.get("/api/coaches", async (c) => {
  try {
    const { data, source } = await getCoaches();
    return c.json(data, 200, { "X-Data-Source": source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

app.get("/api/coach-media/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!SAFE_MEDIA_FILENAME.test(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const media = await readCoachMedia(filename);
  if (!media) {
    return c.json({ error: "Not found" }, 404);
  }
  return media;
});

// ---------------------------------------------------------------------------
// Coach auth (email + one-time code)
// ---------------------------------------------------------------------------

app.post("/api/coach-auth/request", (c) =>
  withJsonBody(c, async (body) => {
    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const email = parsedEmail.email;

    const limit = checkRateLimit(
      `auth:request:${getClientIp(c)}:${email}`,
      env.coachAuthRequestRateLimitMax,
      env.coachAuthRequestRateLimitWindowMs,
    );
    if (limit.limited) {
      return c.json(
        { error: "Too many code requests. Please try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    let debugCode: string | undefined;
    try {
      const resolved = await resolveCoachByEmail(email);
      const code = await createLoginCode(
        resolved.thinkificUserId,
        email,
        env.coachAuthCodeTtlMinutes,
      );
      await sendCoachLoginCode({ toEmail: email, code });
      if (env.coachAuthDebugExposeCode) debugCode = code;
    } catch (err) {
      console.error(
        `[coach-auth] request failed for ${email}: ${(err as Error).message}`,
      );
      // Swallowed to prevent account enumeration.
    }

    return c.json({
      ok: true,
      message: "If this email is eligible, a login code has been sent.",
      ...(debugCode ? { debugCode } : {}),
    });
  }),
);

app.post("/api/coach-auth/verify", (c) =>
  withJsonBody(c, async (body) => {
    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const parsedCode = readRequiredCodeField(body, "code");
    if (!parsedCode.code) {
      return c.json({ error: parsedCode.error ?? "code is required" }, 400);
    }
    const email = parsedEmail.email;
    const code = parsedCode.code;

    const limit = checkRateLimit(
      `auth:verify:${getClientIp(c)}:${email}`,
      env.coachAuthVerifyRateLimitMax,
      env.coachAuthVerifyRateLimitWindowMs,
    );
    if (limit.limited) {
      return c.json(
        { error: "Too many verification attempts. Please try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    try {
      const resolved = await resolveCoachByEmail(email);
      const ok = await verifyAndConsumeLoginCode(
        resolved.thinkificUserId,
        email,
        code,
      );
      if (!ok) return c.json({ error: "Invalid or expired code" }, 401);

      const session = await createCoachSession(
        resolved.thinkificUserId,
        env.coachSessionTtlDays,
      );
      setSessionCookie(c, session.token, session.expiresAt);

      const { data } = await getCoaches();
      const coach = data.coaches.find(
        (item) => item.thinkificUserId === resolved.thinkificUserId,
      );

      return c.json({
        ok: true,
        coach: coach
          ? {
              thinkificUserId: coach.thinkificUserId,
              email: coach.email,
              fullName: coach.fullName,
              tier: coach.tier,
            }
          : { thinkificUserId: resolved.thinkificUserId },
      });
    } catch {
      return c.json({ error: "Invalid or expired code" }, 401);
    }
  }),
);

app.post("/api/coach-auth/logout", async (c) => {
  const token = getCookie(c, env.coachAuthCookieName);
  if (token) await deleteCoachSession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/coach-auth/me", async (c) => {
  const thinkificUserId = await getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

  const { data } = await getCoaches();
  const coach = data.coaches.find(
    (item) => item.thinkificUserId === thinkificUserId,
  );
  if (!coach) return c.json({ error: "Coach not found" }, 404);

  return c.json({
    coach,
    emailLinks: await listCoachEmailLinks(thinkificUserId),
  });
});

app.put("/api/coach-auth/me", (c) =>
  withJsonBody(c, async (body) => {
    const thinkificUserId = await getAuthenticatedThinkificUserId(c);
    if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

    const parsed = parseCoachOverride(body);
    if (!parsed.override) {
      return c.json({ error: parsed.error ?? "Invalid override" }, 400);
    }

    const saved = await upsertCoachOverride(thinkificUserId, parsed.override);
    invalidateCache();
    return c.json({ ok: true, thinkificUserId, override: saved });
  }),
);

app.post("/api/coach-auth/me/avatar", async c => {
  const thinkificUserId = await getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  const avatar = formData.get("avatar");
  if (!(avatar instanceof File)) {
    return c.json({ error: "avatar file is required" }, 400);
  }

  if (avatar.size === 0) {
    return c.json({ error: "avatar file is empty" }, 400);
  }
  if (avatar.size > env.coachAvatarMaxBytes) {
    return c.json(
      {
        error: `avatar file is too large (max ${env.coachAvatarMaxBytes} bytes)`,
      },
      413,
    );
  }

  const extension = IMAGE_MIME_TO_EXT[avatar.type];
  if (!extension) {
    return c.json(
      {
        error:
          "Unsupported avatar type. Allowed: image/jpeg, image/png, image/webp, image/gif",
      },
      400,
    );
  }

  const filename = buildCoachMediaFilename(thinkificUserId, extension);
  await saveCoachMedia(filename, avatar, avatar.type);

  const existingOverride = (await getCoachOverride(thinkificUserId)) ?? {};
  const oldFilename =
    typeof existingOverride.avatarUrl === "string"
      ? resolveManagedCoachMediaFilename(existingOverride.avatarUrl)
      : null;

  const avatarUrl = buildCoachMediaUrl(c, filename);
  const saved = await upsertCoachOverride(thinkificUserId, {
    ...existingOverride,
    avatarUrl,
  });
  invalidateCache();

  if (oldFilename && oldFilename !== filename) {
    deleteCoachMedia(oldFilename).catch(() => {
      // Best-effort cleanup; it's safe to keep old media around.
    });
  }

  return c.json({ ok: true, avatarUrl, override: saved });
});

// ---------------------------------------------------------------------------
// Admin-gated subapp — mounted under /api/coaches *after* the public GET
// so the public route takes precedence for GET /api/coaches.
// ---------------------------------------------------------------------------

const adminCoaches = new Hono();
adminCoaches.use("*", requireAdminApiKey);

adminCoaches.post("/refresh", async (c) => {
  invalidateCache();
  try {
    const { data, source } = await getCoaches();
    return c.json({ refreshed: true, totalCoaches: data.totalCoaches, source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

adminCoaches.post("/resync", async (c) => {
  if (!env.thinkificApiKey || !env.thinkificSubdomain) {
    return c.json(
      {
        error:
          "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN are required for resync.",
      },
      400,
    );
  }
  try {
    const thinkificData = await fetchCoachesFromThinkific();
    await saveThinkificCache(thinkificData);
    const data = await mergeCoachOverrides(thinkificData);
    cache = data;
    cacheSetAt = Date.now();
    return c.json({
      resynced: true,
      source: "thinkific",
      totalCoaches: data.totalCoaches,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

adminCoaches.get("/resolve-user", async (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: "email query param is required" }, 400);
  try {
    const resolved = await resolveCoachByEmail(email);
    return c.json({
      found: true,
      thinkificUserId: resolved.thinkificUserId,
      source: resolved.source,
    });
  } catch {
    return c.json({ found: false });
  }
});

adminCoaches.get("/:thinkificUserId/email-links", async (c) => {
  const id = parseIntParam(c, "thinkificUserId");
  if (id instanceof Response) return id;
  return c.json({ thinkificUserId: id, links: await listCoachEmailLinks(id) });
});

adminCoaches.put("/:thinkificUserId/email-links", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const source = readOptionalStringField(body, "source");
    if (source !== undefined && source.trim() === "") {
      return c.json({ error: "source must not be empty when provided" }, 400);
    }

    const link = await upsertCoachEmailLink(id, parsedEmail.email, source);
    return c.json({ ok: true, link });
  }),
);

adminCoaches.delete("/:thinkificUserId/email-links", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }

    const removed = await deleteCoachEmailLink(id, parsedEmail.email);
    return c.json({ ok: true, removed });
  }),
);

adminCoaches.put("/:thinkificUserId/override", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsed = parseCoachOverride(body);
    if (!parsed.override) {
      return c.json({ error: parsed.error ?? "Invalid override" }, 400);
    }

    const saved = await upsertCoachOverride(id, parsed.override);
    invalidateCache();
    return c.json({ ok: true, thinkificUserId: id, override: saved });
  }),
);

adminCoaches.delete("/:thinkificUserId/override", async (c) => {
  const id = parseIntParam(c, "thinkificUserId");
  if (id instanceof Response) return id;

  await deleteCoachOverride(id);
  invalidateCache();
  return c.json({ ok: true, thinkificUserId: id });
});

app.route("/api/coaches", adminCoaches);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

console.log(`[api] starting on http://localhost:${env.port}`);
console.log(`[api] db mode:          ${env.databaseUrl ? "postgres" : "sqlite"}`);
console.log(`[api] sqlite db:        ${env.coachDataDbPath}`);
console.log(`[api] overrides db:     ${coachOverridesDbDriver}`);
console.log(`[api] media storage:    ${coachMediaStorageMode}`);
console.log(`[api] coaches fallback: ${STATIC_FALLBACK_PATH}`);
console.log(`[api] cors enforce:     ${env.corsEnforceAllowlist}`);
console.log(
  `[api] serve static SPA: ${env.serveStatic} (dir: ${env.webDistPath})`,
);

startRateLimitSweeper(
  Math.max(
    env.coachAuthRequestRateLimitWindowMs,
    env.coachAuthVerifyRateLimitWindowMs,
  ),
);

// Warm the cache so the first user-facing request is instant.
getCoaches().catch((err) =>
  console.error("[api] startup cache warm failed:", err.message),
);

/**
 * Monolith dispatch:
 *   /api/*  → Hono app (JSON API)
 *   else    → built SPA from env.webDistPath (when SERVE_STATIC)
 *             with SPA fallback to index.html for client-routed paths.
 *
 * In dev, set SERVE_STATIC=false (the default outside NODE_ENV=production)
 * and let Vite handle the SPA at 5173 with its /api proxy. In prod, build
 * the web app and run this process as the only public-facing server.
 */
async function fetchHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api")) {
    return app.fetch(req);
  }

  if (env.serveStatic) {
    const staticResponse = await serveStaticSpa(env.webDistPath, url.pathname);
    if (staticResponse) return staticResponse;
  }

  return new Response("Not Found", { status: 404 });
}

export default { port: env.port, fetch: fetchHandler };
