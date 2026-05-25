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
3. Filters are client-side (`tier` + name search).

### Backend (`apps/api`)

The API returns a single normalized coach payload:

- Thinkific certification/user data
- merged with local per-coach override fields (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`)

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

### Override Management (currently open/internal)

- `PUT /api/coaches/:thinkificUserId/override`
  - Upserts allowed override fields
- `DELETE /api/coaches/:thinkificUserId/override`
  - Removes override for that coach

> Note: override endpoints are not auth-protected yet. Add auth before exposing publicly.

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

- Add coach auth flow (magic link/code) before exposing override APIs to end users.
- Move override writes behind authenticated `coach/me` endpoints.
- Add admin/internal trigger for scheduled `resync`.
