import { app } from "./app";
import { env } from "./lib/env";
import { ensureDbSchema } from "./lib/db/schema";
import { coachOverridesDbDriver } from "./lib/db/overrides";
import { coachMediaStorageMode } from "./lib/coach-media";
import { startRateLimitSweeper } from "./lib/rate-limit";
import { startAuthGcSweeper } from "./lib/db/auth";
import { serveStaticSpa } from "./lib/static";
import { getCoaches, STATIC_FALLBACK_PATH } from "./lib/coaches-cache";

await ensureDbSchema();

console.log(`[api] starting on http://localhost:${env.port}`);
console.log(`[api] db mode:          ${env.databaseUrl ? "postgres" : "sqlite"}`);
console.log(`[api] sqlite db:        ${env.coachDataDbPath}`);
console.log(`[api] overrides db:     ${coachOverridesDbDriver}`);
console.log(`[api] media storage:    ${coachMediaStorageMode}`);
console.log(`[api] coaches fallback: ${STATIC_FALLBACK_PATH}`);
console.log(`[api] cors enforce:     ${env.corsEnforceAllowlist}`);
console.log(`[api] serve static SPA: ${env.serveStatic} (dir: ${env.webDistPath})`);

startRateLimitSweeper(
  Math.max(
    env.coachAuthRequestRateLimitWindowMs,
    env.coachAuthVerifyRateLimitWindowMs,
  ),
);

// Drop expired/consumed login codes and expired sessions so they don't
// accumulate in a long-lived process.
startAuthGcSweeper(env.coachAuthGcIntervalMs);

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
