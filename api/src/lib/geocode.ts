/**
 * Best-effort geocoding for coach locations derived from their Thinkific
 * `company` field (usually a gym name). Uses OpenStreetMap Nominatim — no API
 * key, but a 1 req/sec usage policy and a required User-Agent.
 *
 * Company names are noisy seeds: most are brand names, not places, and a naive
 * lookup happily returns a same-named gym on the wrong continent. To keep
 * wrong-country pins off the public map we only accept a match that resolves
 * to a populated PLACE above MIN_IMPORTANCE. That trades coverage for
 * correctness on purpose — a missing pin beats a confidently-wrong one.
 *
 * Results (including misses) are cached to disk so repeated fetches don't
 * re-hit Nominatim.
 */

import { env } from "./env";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_PATH = `${import.meta.dir}/../../data/geocode-cache.json`;

// Nominatim result types we trust as a real location. POI matches
// (sports_centre, aerodrome, bar, school, …) are too often coincidental
// name collisions to accept automatically.
const PLACE_TYPES = new Set([
  "administrative",
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
]);

// Importance is Nominatim's 0–1 relevance score. Cities clear ~0.5; stray POI
// collisions sit well below. 0.45 keeps real towns and drops the noise.
const MIN_IMPORTANCE = 0.45;

// Brand / discipline words stripped so "CrossFit Purmerend" exposes its place
// token ("Purmerend") on a second pass.
const STOP_WORDS = new Set(
  (
    "crossfit fitness gym gyms strength conditioning barbell club athletics " +
    "athletic performance training coaching coach powerhouse power house " +
    "company co inc llc the complete hard lift sports sport center centre " +
    "studio wellness health movement"
  ).split(" "),
);

export interface GeocodeResult {
  lat: number;
  lng: number;
  city?: string;
  state?: string;
}

interface NominatimItem {
  lat: string;
  lon: string;
  type: string;
  importance?: number;
  address?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripBrandWords(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
}

function toResult(item: NominatimItem): GeocodeResult {
  const a = item.address ?? {};
  return {
    lat: Number(item.lat),
    lng: Number(item.lon),
    city:
      a.city || a.town || a.village || a.hamlet || a.municipality || undefined,
    state: a.state || undefined,
  };
}

// Apply the noisy-seed guardrail: only trust a populated-place match above the
// confidence floor. Used for company names, not explicit addresses.
function acceptPlace(item: NominatimItem | null): GeocodeResult | null {
  if (!item) return null;
  if (!PLACE_TYPES.has(item.type)) return null;
  if ((item.importance ?? 0) < MIN_IMPORTANCE) return null;
  return toResult(item);
}

// In-process cache, hydrated from disk on first use. Value is the result or
// `null` (a remembered miss). Address lookups are namespaced with `addr:` to
// avoid colliding with company keys.
let cache: Record<string, GeocodeResult | null> | null = null;

async function loadCache(): Promise<Record<string, GeocodeResult | null>> {
  if (cache) return cache;
  try {
    cache = (await Bun.file(CACHE_PATH).json()) as Record<
      string,
      GeocodeResult | null
    >;
  } catch {
    cache = {};
  }
  return cache;
}

async function cachedLookup(
  key: string,
  run: () => Promise<GeocodeResult | null>,
): Promise<GeocodeResult | null> {
  const store = await loadCache();
  if (key in store) return store[key] ?? null;
  const result = await run();
  store[key] = result;
  await Bun.write(CACHE_PATH, JSON.stringify(store, null, 2));
  return result;
}

async function nominatimTop(q: string): Promise<NominatimItem | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");

  const res = await fetch(url, {
    headers: { "User-Agent": env.geocodeUserAgent },
  });
  if (!res.ok) return null;

  const items = (await res.json()) as NominatimItem[];
  return items[0] ?? null;
}

/**
 * Resolve a company/gym name to a trusted location, or `null` if it can't be
 * confidently placed. Guardrailed because company names are noisy seeds.
 * Cached by company string (case-insensitive).
 */
export async function geocodeCompany(
  company: string,
): Promise<GeocodeResult | null> {
  const key = company.trim().toLowerCase();
  if (!key) return null;

  return cachedLookup(key, async () => {
    let result = acceptPlace(await nominatimTop(company.trim()));
    await sleep(env.geocodeRateLimitMs);

    // Second pass on the brand-stripped variant (e.g. "CrossFit Purmerend").
    if (!result) {
      const cleaned = stripBrandWords(company);
      if (cleaned && cleaned.toLowerCase() !== key) {
        result = acceptPlace(await nominatimTop(cleaned));
        await sleep(env.geocodeRateLimitMs);
      }
    }
    return result;
  });
}

/**
 * Resolve an explicit "city, state" to coordinates. Unlike geocodeCompany this
 * is a high-trust input the coach typed, so we accept Nominatim's top result
 * without the place-type / importance guardrail. Returns `null` only when
 * there's no match at all. Cached by the normalized query.
 */
export async function geocodeAddress(
  city: string,
  state: string,
): Promise<GeocodeResult | null> {
  const q = [city.trim(), state.trim()].filter(Boolean).join(", ");
  if (!q) return null;

  return cachedLookup(`addr:${q.toLowerCase()}`, async () => {
    const item = await nominatimTop(q);
    await sleep(env.geocodeRateLimitMs);
    return item ? toResult(item) : null;
  });
}
