# WSBB Locator

Monorepo for the Westside Barbell certified coach directory.

- `apps/web`: React + Vite frontend map/directory UI
- `apps/api`: Bun + Hono backend for coach data, Thinkific sync, and profile overrides

## Tech Stack

- Runtime: Bun
- Frontend: React 18, Vite, Leaflet
- API: Hono
- Data: SQLite (Bun `bun:sqlite`) for local cache + overrides
- Upstream source: Thinkific Public API

## Project Structure

```text
apps/
  api/
    data/
      coaches-raw.json            # static fallback snapshot
    src/
      index.ts                    # API routes + cache orchestration
      lib/
        env.ts                    # centralized env parsing/defaults
        db.ts                     # shared SQLite connection
        thinkific.ts              # Thinkific API client
        thinkific-cache-db.ts     # persisted Thinkific cache tables
        overrides-db.ts           # local override table
      scripts/
        fetch-thinkific.ts        # one-off fetch to refresh static fallback JSON
  web/
    src/
      App.tsx                     # main directory app shell
```

## How the App Works

### Frontend (`apps/web`)

1. On load, requests `GET /api/coaches`.
2. Renders:
   - tier legend
   - interactive map
   - filter/search controls
   - coach card grid
3. Coach self-service profile access lives on a dedicated page at `/coach-access`.
4. Filters are client-side (`tier` + name search).

### Backend (`apps/api`)

The API returns a single normalized coach payload:

- Thinkific certification/user data
- merged with local per-coach override fields (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`)

Identity matching can use:

- Thinkific primary email
- linked alias emails stored in `coach_email_links` (useful when Thinkific, Shopify, and personal emails differ)

## Caching and Sync Model

`GET /api/coaches` uses **local-first** resolution:

1. **In-memory cache** (fast, TTL-based)
2. **SQLite Thinkific cache tables** (`thinkific_coaches_cache` + `thinkific_cache_meta`)
3. **Live Thinkific fetch** (only if DB cache is empty and Thinkific creds are configured)
4. **Static JSON fallback** (`apps/api/data/coaches-raw.json`)

Why this model:

- API is fast on repeat reads (memory)
- data survives restarts/deploys (SQLite)
- Thinkific is source-of-truth for resync, not hard dependency for every request
- static fallback keeps app running in demo/bootstrap mode

### Resync Behavior

- `POST /api/coaches/resync` performs a live Thinkific pull and **wipe/rewrite** of cache tables.
- `POST /api/coaches/refresh` clears in-memory cache and reloads from the configured source order.

## Override Data Model

Overrides are stored in SQLite table `coach_overrides`, keyed by `thinkific_user_id`.

Allowed override fields:

- `bio`
- `avatarUrl`
- `city`
- `state`
- `lat`
- `lng`

These are merged into the Thinkific payload at response time.

### Email Linking Model

Linked emails are stored in SQLite table `coach_email_links`, keyed by unique normalized email, and mapped to a `thinkific_user_id`.

This allows resolving a coach even when upstream systems use different emails.

## API Endpoints

### Public/Data

- `GET /api/coaches`
  - Returns coach payload
  - Sets `X-Data-Source` response header (`cache`, `db-cache`, `thinkific`, or `static`)
- `POST /api/coaches/refresh`
  - Clears in-memory cache and reloads
- `POST /api/coaches/resync`
  - Live Thinkific pull + rewrite DB cache tables
- `GET /api/health`
  - Basic API/cache health info

### Coach Auth (code + session cookie)

- `POST /api/coach-auth/request`
  - Body: `{ "email": "..." }`
  - Resolves by Thinkific email or linked alias
  - Creates one-time code and sends via configured email provider
  - Returns a generic success response to avoid account enumeration
- `POST /api/coach-auth/verify`
  - Body: `{ "email": "...", "code": "123456" }`
  - Verifies one-time code and sets `HttpOnly` session cookie
- `GET /api/coach-auth/me`
  - Returns authenticated coach payload + email links
- `PATCH /api/coach-auth/me`
  - Authenticated self-service override update (allowed fields only)
- `POST /api/coach-auth/logout`
  - Clears session cookie and invalidates session token

### Override Management (internal/admin path)

- `PUT /api/coaches/:thinkificUserId/override`
  - Upserts allowed override fields
- `DELETE /api/coaches/:thinkificUserId/override`
  - Removes override for that coach

### Identity/Email Linking (internal/admin path)

- `GET /api/coaches/resolve-user?email=...`
  - Resolves coach by email using:
    1. Thinkific primary email, then
    2. linked alias table
- `GET /api/coaches/:thinkificUserId/email-links`
  - Lists linked emails for a coach
- `PUT /api/coaches/:thinkificUserId/email-links`
  - Upserts a link with body: `{ "email": "...", "source": "manual|shopify|..." }`
- `DELETE /api/coaches/:thinkificUserId/email-links`
  - Removes a link with body: `{ "email": "..." }`

> Note: admin/internal endpoints under `/api/coaches/:thinkificUserId/*` are not auth-protected yet.

## Environment Variables

Use `.env.example` as the source of truth.

Required for live Thinkific sync:

- `THINKIFIC_API_KEY`
- `THINKIFIC_SUBDOMAIN`
- `THINKIFIC_LEVEL1_ID`
- `THINKIFIC_LEVEL2_ID`
- `THINKIFIC_LEVEL3_ID`

Optional runtime settings:

- `PORT` (default `3001`)
- `COACH_CACHE_TTL_MS` (default `3600000`)
- `COACH_DATA_DB_PATH` (default `apps/api/data/coach-data.sqlite`)
- `COACH_OVERRIDES_DB_PATH` (legacy alias to same DB path)
- `COACH_AUTH_CODE_TTL_MINUTES` (default `15`)
- `COACH_SESSION_TTL_DAYS` (default `30`)
- `COACH_AUTH_COOKIE_NAME` (default `wsbb_coach_session`)
- `COACH_AUTH_COOKIE_SECURE` (default `false`)
- `COACH_AUTH_DEBUG_EXPOSE_CODE` (default `false`, dev only)
- `COACH_AUTH_REQUEST_RATE_LIMIT_MAX` (default `10`)
- `COACH_AUTH_REQUEST_RATE_LIMIT_WINDOW_MS` (default `600000`)
- `COACH_AUTH_VERIFY_RATE_LIMIT_MAX` (default `20`)
- `COACH_AUTH_VERIFY_RATE_LIMIT_WINDOW_MS` (default `600000`)
- `CORS_ALLOWED_ORIGINS` (comma-separated frontend origins)
- `EMAIL_PROVIDER` (`console` or `resend`, default `console`)
- `EMAIL_FROM` (required for `resend`)
- `RESEND_API_KEY` (required for `resend`)

## Local Development

From repo root:

```bash
bun install
```

Run frontend:

```bash
bun run dev
```

Run API:

```bash
bun run dev:api
```

Run both:

```bash
bun run dev:all
```

Build frontend:

```bash
bun run build
```

## Thinkific Bootstrap / Fallback Snapshot

To refresh static fallback JSON manually:

```bash
bun run fetch
```

This writes `apps/api/data/coaches-raw.json`. The API only uses this when local DB cache and live Thinkific are unavailable.

## Current Gaps / Next Steps

- Move auth rate limits to shared infra (Redis/edge) if deploying multiple API instances.
- Protect admin/internal `/api/coaches/:thinkificUserId/*` routes with admin auth.
- Add admin/internal trigger for scheduled `resync`.
