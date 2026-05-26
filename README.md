# WSBB Locator

Bun monorepo for the Westside Barbell certified coach directory.

- `apps/web` — React + Vite frontend (map, filters, coach directory, profile self-serve)
- `apps/api` — Bun + Hono API (Thinkific sync, caching, coach auth, profile overrides). In production also serves the built SPA from the same process.

## Quick Start

```bash
bun install
bun run dev:all
```

- Frontend (Vite dev server with HMR): `http://localhost:5173`
- API: `http://localhost:3001` (Vite proxies `/api/*` to it)

## Run modes

| Mode       | Command           | Layout                                                                                              |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Dev        | `bun run dev:all` | Vite at 5173 (SPA + HMR) + Bun API at 3001. Vite proxies `/api/*` to the API.                       |
| Production | `bun run start`   | Builds the SPA, then one Bun process serves both `/api/*` and the static SPA from `apps/web/dist/`. |

In production mode `SERVE_STATIC=true` makes the API also handle non-`/api` paths: known files are served verbatim, unknown paths without an extension fall through to `index.html` so the client router takes over.

## Scripts

- `bun run dev` — frontend only
- `bun run dev:api` — API only
- `bun run dev:all` — frontend + API
- `bun run build` — build the SPA into `apps/web/dist/`
- `bun run start` — build, then run the monolith (API + SPA on one port)
- `bun run test` — `bun test` in `apps/api`
- `bun run fetch` — refresh the static fallback snapshot from Thinkific
- `bun run format` — Prettier

## Stack

- Runtime: Bun
- Frontend: React 18, Vite, Leaflet, lucide-react
- API: Hono on `Bun.serve`
- Data: SQLite via `bun:sqlite`
- Upstream data source: Thinkific Public API
- Email (optional): Resend

## Architecture

### Data flow

`GET /api/coaches` resolves data in this order:

1. In-memory cache (TTL from `COACH_CACHE_TTL_MS`, default 1h)
2. SQLite cache tables (`thinkific_coaches_cache`, `thinkific_cache_meta`)
3. Live Thinkific fetch (if credentials configured)
4. Static fallback (`apps/api/data/coaches-raw.json`)

The response includes an `X-Data-Source` header so clients (and ops) can see which layer answered. The API merges Thinkific coach data with local overrides from `coach_overrides` — only the six safe fields (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`) are allowed to override; identity columns always come from Thinkific.

### Identity resolution

A coach is matched by either:

- Their primary Thinkific email, or
- Any alias stored in `coach_email_links` (for cross-system mismatches, e.g. Thinkific vs. Shopify).

### Auth

Email + one-time 6-digit code, hashed with SHA-256 before storage. Verified codes mint a 32-byte hex session token (also stored as a hash) and set an HttpOnly+SameSite=Lax cookie. Rate-limited per (IP, email) for both `request` and `verify`. The in-process rate-limit map is swept on the longest configured window.

> Single-instance only — see "Known gaps" before scaling horizontally.

### Schema

Each `db/*.ts` module declares its own tables with `CREATE TABLE IF NOT EXISTS` at import time. No migration framework — this is greenfield and the schema lives next to the queries that use it.

## API surface

### Public

- `GET /api/coaches` (returns `X-Data-Source: cache | db-cache | thinkific | static`)
- `GET /api/health`

### Coach auth (cookie session)

- `POST /api/coach-auth/request` `{ email }`
- `POST /api/coach-auth/verify` `{ email, code }` → sets `wsbb_coach_session` cookie
- `POST /api/coach-auth/logout`
- `GET /api/coach-auth/me` — current coach + linked emails
- `PUT /api/coach-auth/me` — replace override (bio/avatarUrl/city/state/lat/lng); omitted fields become NULL
- `POST /api/coach-auth/me/avatar` (`multipart/form-data`, field `avatar`) — upload and persist coach avatar image (Railway bucket/S3 when configured)
- `GET /api/coach-media/:filename` — serves uploaded avatar files through the API (works with private Railway buckets)

### Admin (requires `COACH_ADMIN_API_KEY`)

Send the key as either `x-admin-api-key: <key>` or `Authorization: Bearer <key>`.

- `POST /api/coaches/refresh`
- `POST /api/coaches/resync`
- `GET /api/coaches/resolve-user?email=...`
- `GET | PUT | DELETE /api/coaches/:thinkificUserId/email-links`
- `PUT | DELETE /api/coaches/:thinkificUserId/override`

## Project layout

```text
apps/
  api/
    data/
      coaches-raw.json
    src/
      index.ts                     # Hono app + Bun.serve dispatcher
      lib/
        env.ts
        admin-auth.ts
        email.ts
        http.ts                    # withJsonBody, parseIntParam, getClientIp
        rate-limit.ts              # in-process sliding-window limiter
        request-validation.ts
        static.ts                  # SPA static handler
        thinkific.ts
        db/
          db.ts                    # shared sqlite connection + pragmas
          auth.ts                  # login codes + sessions
          email-links.ts
          overrides.ts
          thinkific-cache.ts
      scripts/
        fetch-thinkific.ts
  web/
    src/
      main.tsx
      pages/                       # LandingPage, CoachAccessPage, NotFoundPage
      components/                  # CoachMap, CoachCard, FilterBar, ...
      lib/types.ts
      styles/
```

## Environment

`.env.example` is the source of truth. Notable additions in this version:

- `THINKIFIC_RATE_LIMIT_MS` (default `500`) — sleep between Thinkific pages/users
- `WEB_DIST_PATH` — overrides where the API looks for the built SPA (defaults to `apps/web/dist`)
- `SERVE_STATIC` (default: `true` in production, `false` otherwise) — toggles the SPA static handler in the API process

Required for live Thinkific sync:

- `THINKIFIC_API_KEY`
- `THINKIFIC_SUBDOMAIN`
- `THINKIFIC_LEVEL1_ID`
- `THINKIFIC_LEVEL2_ID`
- `THINKIFIC_LEVEL3_ID`

Common optional settings:

- `PORT` (default `3001`)
- `COACH_CACHE_TTL_MS`
- `COACH_DATA_DB_PATH`
- `COACH_AVATAR_STORAGE_DRIVER` (`auto` default; `s3` or `local`)
- `COACH_UPLOADS_DIR` (used in `local` mode; default `apps/api/data/coach-uploads`)
- `COACH_AVATAR_MAX_BYTES` (default `5242880`)
- `COACH_AVATAR_S3_PREFIX` (default `coach-avatars`)
- `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` (or `BUCKET`), `AWS_DEFAULT_REGION`, `AWS_S3_URL_STYLE`
- `COACH_ADMIN_API_KEY`
- `CORS_ALLOWED_ORIGINS` + `CORS_ENFORCE_ALLOWLIST`
- `EMAIL_PROVIDER` (`console` or `resend`)
- `RESEND_API_KEY` / `EMAIL_FROM` (when `EMAIL_PROVIDER=resend`)
- `COACH_AUTH_*_RATE_LIMIT_*`, `COACH_AUTH_CODE_TTL_MINUTES`, `COACH_SESSION_TTL_DAYS`, `COACH_AUTH_COOKIE_*`

## Testing

```bash
bun run test
```

Currently covers the auth state machine (`createLoginCode → verify → createSession → getSession → delete`) against an isolated sqlite file. Worth expanding before adding additional auth flows.

## Known gaps

- Rate limiting is in-process — move to Redis (or similar) before running >1 API instance.
- No scheduled Thinkific resync trigger; admin-triggered only.
- Tests cover auth primitives but not the route layer.
