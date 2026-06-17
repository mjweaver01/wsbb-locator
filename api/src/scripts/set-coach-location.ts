/**
 * Set a coach's public map location by city/state (admin one-off).
 *
 * Usage:
 *   bun run api/src/scripts/set-coach-location.ts <email> <city> [state]
 *
 * Resolves the coach by email, geocodes "city, state" the same way the coach
 * self-serve flow does, then writes the city/state/lat/lng override (preserving
 * any existing bio/avatar/master grant). Targets whatever DB the env points at
 * — sqlite locally, Postgres when DATABASE_URL is set.
 *
 * After running, refresh the live cache: restart the API or
 * `POST /api/coaches/refresh`.
 */
import { resolveCoachByEmail } from "../lib/coach-session";
import { geocodeAddress } from "../lib/geocode";
import { getCoachOverride, upsertCoachOverride } from "../lib/db/overrides";

const [email, city, state = ""] = process.argv.slice(2);

if (!email || !city) {
  console.error(
    "Usage: bun run api/src/scripts/set-coach-location.ts <email> <city> [state]",
  );
  process.exit(1);
}

const label = [city, state].filter(Boolean).join(", ");

try {
  const { thinkificUserId } = await resolveCoachByEmail(email);

  const geo = await geocodeAddress(city, state);
  if (!geo) {
    console.error(`Could not geocode "${label}".`);
    process.exit(1);
  }

  const existing = (await getCoachOverride(thinkificUserId)) ?? {};
  await upsertCoachOverride(thinkificUserId, {
    ...existing,
    city,
    state,
    lat: geo.lat,
    lng: geo.lng,
  });

  console.log(
    `✓ ${email} (#${thinkificUserId}) → ${label} @ ${geo.lat}, ${geo.lng}`,
  );
} catch (err) {
  console.error("Error:", (err as Error).message);
  process.exit(1);
}
