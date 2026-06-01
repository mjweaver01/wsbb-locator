# Architecture

Reference for how the API and SPA fit together, what the API exposes, and which env vars matter.

## Stack

- Runtime: Bun
- Frontend: React 19, Vite, Leaflet, lucide-react, react-router
- API: Hono on `Bun.serve`
- Data: SQLite via `bun:sqlite` (default) or Postgres via `pg` (when `DATABASE_URL` is set)
- Upstream data source: Thinkific Public API
- Email (optional): Resend
- Media storage: local FS (default) or S3-compatible (auto when AWS creds are configured)

## Run modes

| Mode       | Command           | Layout                                                                                              |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| Dev        | `bun run dev:all` | Vite at 5173 (SPA + HMR) + Bun API at 3001. Vite proxies `/api/*` to the API.                       |
| Production | `bun run start`   | Builds the SPA, then one Bun process serves both `/api/*` and the static SPA from `web/dist/`.      |

In production mode `SERVE_STATIC=true` makes the API handle non-`/api` paths: known files are served verbatim, unknown extensionless paths fall through to `index.html` so the client router takes over.

## Shared code (`shared/`)

The API and SPA are one repo and speak one wire contract, so the domain types and tier ordering that define that contract live in a top-level `shared/` directory rather than being redefined on each side. Both workspaces reach it through the `@shared/*` path alias (`api/tsconfig.json`, `web/tsconfig.json`, and `web/vite.config.ts`).

| File              | Owns                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/coach.ts` | Canonical domain types — `Coach`, `CoachesPayload`, `CoachTier`, `RawCertification`, `CoachEmailLink`, `MeResponse`. Single source of truth for the FE/BE wire shape. |
| `shared/tiers.ts` | Tier **ordering** only: `TIER_ORDER` (display order) and `TIER_RANK` (precedence when a coach qualifies for multiple levels).          |

The boundary is deliberate: `shared/` holds the contract and pure logic that both sides must agree on. Presentation stays local — tier **labels and colors** live in `web/src/lib/tiers.ts` (which imports `TIER_ORDER`/`TIER_RANK`), and the API imports `TIER_RANK` to pick a coach's headline tier. The web client's `apiUrl` helper (`web/src/lib/api.ts`) centralizes the `/api` base so components don't each thread an `apiBase` prop.

When you add a field to the coach contract, edit `shared/coach.ts` once; both `tsc` runs will flag every call site that needs updating.

## Data model: base data + overrides

Two layers, with a clear precedence rule:

1. **Base data** comes from Thinkific (identity, tier, certifications, company). It is refreshed **only by explicit write triggers** — never as a side effect of a read.
2. **Overrides** are the edits coaches make in our UI (`coach_overrides`). For the six safe profile fields (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`) the override **supersedes** the Thinkific base. Identity columns (id/email/name/tier/certifications) always come from Thinkific, even if a malformed override row contains them.

So: if a coach updates their info in Thinkific, an explicit resync updates our base data. If they update it in our UI, that override wins until they clear it.

## Read path (never calls Thinkific)

`GET /api/coaches` resolves data in this order — and **stops before ever contacting Thinkific**:

1. In-memory cache (TTL from `COACH_CACHE_TTL_MS`, default 1h)
2. SQLite/Postgres cache tables (`thinkific_coaches_cache`, `thinkific_cache_meta`)
3. Static seed (`api/data/coaches-raw.json`)

Every layer is merged with `coach_overrides` before being returned. The response includes an `X-Data-Source` header (`cache | db-cache | static`) so clients and ops can see which layer answered.

## Write path (the only Thinkific calls)

Thinkific is contacted exclusively by explicit triggers, which fetch live data, persist it to the DB cache, and seed the in-memory cache (`resyncFromThinkific` in `coaches-cache.ts`):

- An admin pull (`POST /api/coaches/resync`, or `refresh` to also bust the in-memory cache).
- A coach's own profile update / avatar upload (writes their override row).
- A future Thinkific webhook (same `resyncFromThinkific` entry point).

This is why the read path can never stall on a slow or rate-limited Thinkific API: nothing reads from Thinkific synchronously.

## Identity resolution

A coach is matched by either:

- Their primary Thinkific email, or
- Any alias stored in `coach_email_links` (for cross-system mismatches, e.g. Thinkific vs. Shopify).

## Auth

Email + one-time 6-digit code, hashed with SHA-256 before storage. Verified codes mint a 32-byte hex session token (also stored as a hash) and set an HttpOnly + SameSite=Lax cookie. Rate-limited per (IP, email) for both `request` and `verify`. The in-process rate-limit map is swept on the longest configured window. Expired/consumed login codes and expired sessions are purged on an interval (`COACH_AUTH_GC_INTERVAL_MS`, default 1h) so they don't accumulate in a long-lived process — reads already reject them, so this is storage hygiene only.

> Single-instance only — see [Known gaps](#known-gaps) before scaling horizontally.

## Schema

Two backends share one schema module (`lib/db/schema.ts`) that runs `CREATE TABLE IF NOT EXISTS` at startup. SQLite is the default; setting `DATABASE_URL` switches the override / auth / cache modules to Postgres. No migration framework — schema lives next to the queries that use it.

## API surface

### Public

- `GET /api/coaches` — returns `X-Data-Source: cache | db-cache | static` (read path never calls Thinkific)
- `GET /api/health`
- `GET /api/coach-media/:filename` — serves uploaded avatar files through the API (works with private buckets)

### Coach auth (cookie session)

- `POST /api/coach-auth/request` `{ email }`
- `POST /api/coach-auth/verify` `{ email, code }` → sets `wsbb_coach_session` cookie, returns `{ ok, me }`
- `POST /api/coach-auth/logout`
- `GET /api/coach-auth/me` — current coach + linked emails
- `PUT /api/coach-auth/me` — replace override (bio/avatarUrl/city/state/lat/lng); omitted fields become NULL. When city/state are present but no coordinates are supplied, the server geocodes them to lat/lng (see [`docs/THINKIFIC.md`](./THINKIFIC.md)) so coaches never enter coordinates by hand. Returns `{ ok, me }`
- `POST /api/coach-auth/me/avatar` (`multipart/form-data`, field `avatar`) — upload and persist coach avatar image. Returns `{ ok, avatarUrl, me }`

### Admin (requires `COACH_ADMIN_API_KEY`)

Send the key as either `x-admin-api-key: <key>` or `Authorization: Bearer <key>`.

- `POST /api/coaches/refresh`
- `POST /api/coaches/resync`
- `POST /api/coaches/invite` `{ email }` or `{ emails: string[] }` — emails each coach a longer-lived login code plus a deep link to `/coach-access?email=...` so they can self-update their listing. Returns `{ ok, sent, total, results: [{ email, ok, thinkificUserId?, error? }] }`. Reuses the existing OTP machinery; code TTL is `COACH_INVITE_CODE_TTL_MINUTES`. The SPA route `/admin` (`AdminInvitePage`) provides a UI for this: paste the admin key, load coaches, multi-select, and send.
- `GET /api/coaches/resolve-user?email=...`
- `GET | PUT | DELETE /api/coaches/:thinkificUserId/email-links`
- `PUT | DELETE /api/coaches/:thinkificUserId/override`

## Project layout

```text
shared/                        # FE/BE contract, imported via @shared/*
  coach.ts                     # Coach, CoachesPayload, MeResponse, ...
  tiers.ts                     # TIER_ORDER, TIER_RANK (ordering only)
api/
  data/
    coaches-raw.json
  src/
    index.ts                  # Bun.serve entry + startup
    app.ts                    # Hono + middleware + route mount
    routes/
      public.ts               # health, coaches, coach-media GET
      coach-auth.ts           # /api/coach-auth/*
      admin-coaches.ts        # admin subapp under /api/coaches
    lib/
      env.ts
      admin-auth.ts
      coach-media.ts          # storage (local FS / S3)
      coach-media-url.ts      # route prefix + URL helpers
      coach-session.ts        # cookies, loadMe, resolveCoach
      coaches-cache.ts        # in-memory + db cache + merge
      cors-allowlist.ts       # origin matcher (exact + *.wildcard)
      email.ts                # console / Resend
      http.ts                 # withJsonBody, parseIntParam, getClientIp
      rate-limit.ts           # in-process sliding-window limiter
      request-validation.ts
      static.ts               # SPA static handler
      thinkific.ts            # Thinkific client
      db/
        db.ts                 # lazy sqlite connection + pragmas
        pg.ts                 # lazy postgres pool
        schema.ts             # CREATE TABLE IF NOT EXISTS for both backends
        auth.ts               # login codes + sessions
        email-links.ts
        overrides.ts
        thinkific-cache.ts
    scripts/
      fetch-thinkific.ts
web/
  src/
    main.tsx
    pages/                    # LandingPage, CoachAccessPage, AdminInvitePage, NotFoundPage
    components/               # CoachMap, CoachCard, FilterBar, ...
    lib/
      api.ts                  # API_BASE + apiUrl/apiFetch helpers
      tiers.ts                # tier labels/colors (re-exports @shared ordering)
      types.ts                # re-exports @shared/coach
    styles/
```

## Environment

`.env.example` is the source of truth. Notable knobs:

### Runtime / deploy

- `PORT` (default `3001`)
- `APP_BASE_URL` (alias `PUBLIC_APP_URL`) — public base URL of the SPA, used to build absolute links in invite emails. Falls back to the request origin when unset.
- `SERVE_STATIC` (default `true` in production, `false` otherwise) — toggles the SPA static handler in the API process
- `WEB_DIST_PATH` — overrides where the API looks for the built SPA (default `web/dist`)
- `TRUST_PROXY` (default `true` in production) — when on, `X-Forwarded-For` / `X-Real-IP` are honored for rate-limit keys. Disable when the API is exposed directly without a reverse proxy.
- `CORS_ALLOWED_ORIGINS` + `CORS_ENFORCE_ALLOWLIST` — comma-separated origins. Each entry is either an exact origin (`https://westside-barbell.com`) or a `*.` subdomain wildcard (`https://*.westside-barbell.com`, which matches any subdomain but NOT the apex — list both when you need both).

### Data

- `COACH_CACHE_TTL_MS` (default 1h)
- `COACH_DATA_DB_PATH` (sqlite mode)
- `DATABASE_URL` — when set, persistence moves to Postgres
- `THINKIFIC_RATE_LIMIT_MS` (default `500`) — sleep between Thinkific pages/users

### Thinkific sync (required for live data)

- `THINKIFIC_API_KEY` — a JWT API access token, sent as `Authorization: Bearer …`. See [`docs/THINKIFIC.md`](./THINKIFIC.md).
- `THINKIFIC_SUBDOMAIN`
- `THINKIFIC_LEVEL1_ID` / `THINKIFIC_LEVEL2_ID` / `THINKIFIC_LEVEL3_ID` — course IDs per pathway level (run `bun run fetch` with these empty to list all courses)
- `THINKIFIC_SSO_SECRET` — present but currently unused (reserved for future SSO)

### Auth + admin

- `COACH_ADMIN_API_KEY`
- `COACH_AUTH_*_RATE_LIMIT_*`, `COACH_AUTH_CODE_TTL_MINUTES`, `COACH_INVITE_CODE_TTL_MINUTES` (default 72h), `COACH_SESSION_TTL_DAYS`, `COACH_AUTH_COOKIE_*`

### Email

- `EMAIL_PROVIDER` (`console` or `resend`)
- `RESEND_API_KEY` / `EMAIL_FROM` (when `EMAIL_PROVIDER=resend`)

### Avatar storage

- `COACH_AVATAR_STORAGE_DRIVER` (`auto` default; `s3` or `local`)
- `COACH_UPLOADS_DIR` (local mode; default `api/data/coach-uploads`)
- `COACH_AVATAR_MAX_BYTES` (default 5 MB)
- `COACH_AVATAR_S3_PREFIX` (default `coach-avatars`)
- `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` (or `BUCKET`), `AWS_DEFAULT_REGION`, `AWS_S3_URL_STYLE`

## Testing

```bash
bun run test
```

Currently covers:

- Auth state machine (`createLoginCode → verify → createSession → getSession → delete`) against an isolated sqlite file (`lib/db/auth.test.ts`).
- HTTP helpers — `withJsonBody`, `parseIntParam`, `getClientIp` (including the `TRUST_PROXY` gate) (`lib/http.test.ts`).
- Rate limiter sliding-window + sweeper (`lib/rate-limit.test.ts`).
- `parseCoachOverride` Zod validation matrix (`lib/request-validation.test.ts`).
- `mergeCoachOverrides` precedence + tier recompute, using injected overrides so it stays a pure unit test (`lib/coaches-cache.test.ts`).

Worth expanding next: `isOriginAllowed` allowlist matrix, `serveStaticSpa` extension routing + `..` rejection, and route-level tests via `app.fetch(new Request(...))`.

## Known gaps

- Rate limiting is in-process — move to Redis (or similar) before running >1 API instance.
- No scheduled Thinkific resync trigger; admin-triggered only.
- Tests cover auth primitives and helpers but not the route layer.
- Expired-auth-row GC is per-instance (each process sweeps the shared DB); harmless but redundant if you run multiple instances.
