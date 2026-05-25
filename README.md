# WSBB Locator

WSBB Locator is a monorepo for the Westside Barbell certified coach directory.

- `apps/web`: React + Vite frontend (map, filters, coach directory)
- `apps/api`: Bun + Hono API (Thinkific sync, caching, coach auth, profile overrides)

## Quick Start

```bash
bun install
bun run dev:all
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

## Scripts

- `bun run dev` - run frontend
- `bun run dev:api` - run API
- `bun run dev:all` - run frontend + API
- `bun run build` - build frontend
- `bun run fetch` - refresh fallback coach snapshot

## Stack

- Runtime: Bun
- Frontend: React 18, Vite, Leaflet
- API: Hono
- Data: SQLite (`bun:sqlite`)
- Upstream data source: Thinkific Public API

## Architecture Overview

### Data Flow

`GET /api/coaches` resolves data in this order:

1. In-memory cache
2. SQLite cache tables (`thinkific_coaches_cache`, `thinkific_cache_meta`)
3. Live Thinkific fetch (if configured)
4. Static fallback (`apps/api/data/coaches-raw.json`)

The API merges Thinkific coach data with local overrides from `coach_overrides` (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`).

### Identity Resolution

Coach identity can be matched by:

- Primary Thinkific email
- Linked alias emails in `coach_email_links`

This supports cross-system email differences (for example Thinkific vs Shopify).

## API Surface

### Public/Data

- `GET /api/coaches` (includes `X-Data-Source` header)
- `GET /api/health`

### Coach Auth

- `POST /api/coach-auth/request`
- `POST /api/coach-auth/verify`
- `GET /api/coach-auth/me`
- `PATCH /api/coach-auth/me`
- `POST /api/coach-auth/logout`

### Internal/Admin

- `POST /api/coaches/refresh`
- `POST /api/coaches/resync`
- `PUT /api/coaches/:thinkificUserId/override`
- `DELETE /api/coaches/:thinkificUserId/override`
- `GET /api/coaches/resolve-user?email=...`
- `GET | PUT | DELETE /api/coaches/:thinkificUserId/email-links`

> Internal/admin routes require `COACH_ADMIN_API_KEY` and either `x-admin-api-key` or `Authorization: Bearer <key>`.

## Environment

Use `.env.example` as the source of truth.

Required for live Thinkific sync:

- `THINKIFIC_API_KEY`
- `THINKIFIC_SUBDOMAIN`
- `THINKIFIC_LEVEL1_ID`
- `THINKIFIC_LEVEL2_ID`
- `THINKIFIC_LEVEL3_ID`

Common optional settings:

- `PORT`
- `COACH_CACHE_TTL_MS`
- `COACH_DATA_DB_PATH`
- `COACH_ADMIN_API_KEY`
- `CORS_ALLOWED_ORIGINS`
- `EMAIL_PROVIDER` (`console` or `resend`)
- `RESEND_API_KEY` / `EMAIL_FROM` (when using `resend`)

## Project Layout

```text
apps/
  api/
    data/
      coaches-raw.json
    src/
      index.ts
      lib/
        env.ts
        db.ts
        thinkific.ts
        thinkific-cache-db.ts
        overrides-db.ts
      scripts/
        fetch-thinkific.ts
  web/
    src/
      App.tsx
```

## Known Gaps

- Move auth rate limiting to shared infra for multi-instance deployments
- Add a protected/scheduled `resync` trigger
