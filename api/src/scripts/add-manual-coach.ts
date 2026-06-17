/**
 * Add (or update) a manually-managed "house" coach who isn't in Thinkific —
 * e.g. the company owner or staff. Geocodes the city/state to a map pin the
 * same way the coach self-serve flow does.
 *
 * Usage:
 *   bun run api/src/scripts/add-manual-coach.ts <email> "<Full Name>" <tier> [city] [state]
 *
 *   tier ∈ master | certified | candidate
 *
 * Example:
 *   bun run api/src/scripts/add-manual-coach.ts tom@westside-barbell.com \
 *     "Tom Barry" master "Columbus" "OH"
 *
 * Targets whatever DB the env points at (sqlite locally, Postgres when
 * DATABASE_URL is set). Afterwards refresh the cache: restart the API or
 * `POST /api/coaches/refresh`.
 */
import { geocodeAddress } from "../lib/geocode";
import { upsertManualCoach } from "../lib/db/manual-coaches";
import type { CoachTier } from "@shared/coach";

const [email, fullName, tier, city = "", state = ""] = process.argv.slice(2);

const VALID_TIERS: CoachTier[] = ["master", "certified", "candidate"];

if (!email || !fullName || !tier) {
  console.error(
    'Usage: bun run api/src/scripts/add-manual-coach.ts <email> "<Full Name>" <tier> [city] [state]',
  );
  process.exit(1);
}
if (!VALID_TIERS.includes(tier as CoachTier)) {
  console.error(`tier must be one of: ${VALID_TIERS.join(", ")}`);
  process.exit(1);
}

const [firstName, ...rest] = fullName.trim().split(/\s+/);
const lastName = rest.join(" ");

try {
  let lat: number | null = null;
  let lng: number | null = null;
  if (city) {
    const geo = await geocodeAddress(city, state);
    if (!geo) {
      console.error(
        `Could not geocode "${[city, state].filter(Boolean).join(", ")}".`,
      );
      process.exit(1);
    }
    lat = geo.lat;
    lng = geo.lng;
  }

  await upsertManualCoach({
    email,
    firstName: firstName ?? fullName,
    lastName,
    tier: tier as CoachTier,
    city: city || null,
    state: state || null,
    lat,
    lng,
  });

  const where = city ? ` → ${[city, state].filter(Boolean).join(", ")}` : "";
  const pin = lat != null ? ` @ ${lat}, ${lng}` : " (no map pin)";
  console.log(`✓ ${fullName} <${email}> added as ${tier}${where}${pin}`);
} catch (err) {
  console.error("Error:", (err as Error).message);
  process.exit(1);
}
