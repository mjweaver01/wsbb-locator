# Thinkific Integration

How coach data gets from Thinkific into the directory. The client lives in `api/src/lib/thinkific.ts`; the snapshot script is `api/src/scripts/fetch-thinkific.ts` (`bun run fetch`).

## Authentication

`THINKIFIC_API_KEY` is an API access token — a JWT (three dot-separated base64 chunks starting `eyJ...`). We send it as a Bearer header against the `/api/public/v1` endpoints:

```
Authorization: Bearer <THINKIFIC_API_KEY>
```

The JWT already encodes the subdomain (decode the middle segment to see `subdomain`, `scope`, `exp`), so `X-Auth-Subdomain` is sent only for parity and isn't strictly required.

> Token expiry lives in the JWT `exp` claim. When live fetches start returning `401 Authentication Error`, decode the token and check `exp` before assuming a code bug. The current token expires in 2027.

Quick sanity check without running the app:

```bash
TOKEN=$(grep '^THINKIFIC_API_KEY=' .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.thinkific.com/api/public/v1/courses?limit=1" | head -c 200
```

`200` + JSON = good. `401` = expired or invalid token.

## Tiers ↔ courses

Each pathway level maps to one Thinkific course ID. A coach's tier is the **highest** level they've completed; all completions are kept in `certifications`.

| Env var | Level | Tier |
| ------- | ----- | ---- |
| `THINKIFIC_LEVEL1_ID` | 1 | `certified` |
| `THINKIFIC_LEVEL2_ID` | 2 | `instructor` |
| `THINKIFIC_LEVEL3_ID` | 3 | `master` |

**Finding course IDs:** leave the three `*_ID` vars empty and run `bun run fetch`. The client lists every course (`id` + `name`) and throws, so you can copy the right IDs in.

## How the fetch works

1. For each configured course, page through `/enrollments?query[course_id]=…&query[completed]=true`.
2. Group enrollments by `user_id`, tracking the highest tier + all certs.
3. Look up each unique user via `/users/:id` for name / email / avatar / bio.
4. Write `api/data/coaches-raw.json` (the static fallback) with `tierBreakdown` + `fetchedAt`.

Calls are throttled by `THINKIFIC_RATE_LIMIT_MS` (default 500ms) between every page **and** every user lookup, so a few hundred coaches takes a couple of minutes. That's expected, not a hang.

## Making fetched data go live

`bun run fetch` only rewrites the static snapshot. To serve it through `/api/coaches`, bust the in-memory + DB cache (see the source order in `docs/ARCHITECTURE.md`):

```bash
curl -X POST http://localhost:3001/api/coaches/refresh \
  -H "x-admin-api-key: $COACH_ADMIN_API_KEY"
```

…or just restart the API.

## Known data gaps

- **Bios and avatars are mostly empty in Thinkific.** These are filled by coaches via the self-serve `/coach-access` flow (local overrides), not upstream. Don't expect them from the API.
- Only the six override fields (`bio`, `avatarUrl`, `city`, `state`, `lat`, `lng`) can be overridden locally; identity always comes from Thinkific.

## `THINKIFIC_SSO_SECRET`

Configured in `.env` but **not yet used** anywhere in the codebase. It's the Thinkific SSO signing secret, reserved for a future single-sign-on handoff (minting signed JWTs to log coaches straight into the Thinkific site). No-op until that's built.
