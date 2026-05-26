# WSBB Locator

Bun monorepo for the Westside Barbell certified coach directory.

- `web/` — React + Vite SPA (map, filters, coach directory, profile self-serve)
- `api/` — Bun + Hono API (Thinkific sync, caching, coach auth, profile overrides). Also serves the built SPA in production.

## Quick start

```bash
bun install
bun run dev:all
```

- Frontend: `http://localhost:5173` (Vite, HMR; proxies `/api/*` to the API)
- API: `http://localhost:3001`

## Scripts

| Script               | What it does                                                  |
| -------------------- | ------------------------------------------------------------- |
| `bun run dev:all`    | Frontend + API together (use `dev` / `dev:api` to run either) |
| `bun run build`      | Build the SPA into `web/dist/`                                |
| `bun run start`      | Build, then run API + SPA from a single Bun process           |
| `bun run test`       | `bun test` inside `api/`                                      |
| `bun run fetch`      | Refresh the static fallback snapshot from Thinkific           |
| `bun run format`     | Prettier                                                      |

## More

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — data flow, API surface, project layout, environment, known gaps
- `.env.example` — full env-var reference (source of truth)
