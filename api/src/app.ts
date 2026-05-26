import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./lib/env";
import { isOriginAllowed } from "./lib/cors-allowlist";
import { publicRoutes } from "./routes/public";
import { coachAuthRoutes } from "./routes/coach-auth";
import { adminCoachesRoutes } from "./routes/admin-coaches";

export const app = new Hono();

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
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
    },
    strictTransportSecurity: env.coachAuthCookieSecure
      ? "max-age=31536000; includeSubDomains"
      : false,
  }),
);

// CORS is only useful in dev (Vite at :5173 → API at :3001) and any
// cross-origin embed scenario. In single-origin prod (SERVE_STATIC=true)
// browsers won't even emit Origin for same-origin requests, so this is a
// no-op there anyway.
app.use(
  "*",
  cors({
    // Never return "*" while credentials:true — browsers reject that combo.
    // Same-origin requests omit Origin; returning "" (falsy) drops the
    // header entirely, which is the correct behavior for those.
    origin: (origin) => {
      if (!origin) return "";
      if (!env.corsEnforceAllowlist) return origin;
      return isOriginAllowed(origin, env.corsAllowedOrigins) ? origin : "";
    },
    credentials: true,
  }),
);

// Public routes are mounted first so GET /api/coaches resolves to the
// public handler — the admin subapp below only exposes other verbs/paths
// under /api/coaches, but Hono matches in declaration order.
app.route("/", publicRoutes);
app.route("/", coachAuthRoutes);
app.route("/api/coaches", adminCoachesRoutes);
