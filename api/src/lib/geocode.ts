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

// In-process cache, hydrated from disk on first use. Value is the result or
// `null` (a remembered miss).
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

async function queryNominatim(q: string): Promise<GeocodeResult | null> {
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
  const top = items[0];
  if (!top) return null;
  if (!PLACE_TYPES.has(top.type)) return null;
  if ((top.importance ?? 0) < MIN_IMPORTANCE) return null;

  const a = top.address ?? {};
  return {
    lat: Number(top.lat),
    lng: Number(top.lon),
    city:
      a.city || a.town || a.village || a.hamlet || a.municipality || undefined,
    state: a.state || undefined,
  };
}

/**
 * Resolve a company/gym name to a trusted location, or `null` if it can't be
 * confidently placed. Cached by company string (case-insensitive).
 */
export async function geocodeCompany(
  company: string,
): Promise<GeocodeResult | null> {
  const key = company.trim().toLowerCase();
  if (!key) return null;

  const store = await loadCache();
  if (key in store) return store[key] ?? null;

  let result = await queryNominatim(company.trim());
  await sleep(env.geocodeRateLimitMs);

  // Second pass on the brand-stripped variant (e.g. "CrossFit Purmerend").
  if (!result) {
    const cleaned = stripBrandWords(company);
    if (cleaned && cleaned.toLowerCase() !== key) {
      result = await queryNominatim(cleaned);
      await sleep(env.geocodeRateLimitMs);
    }
  }

  store[key] = result;
  await Bun.write(CACHE_PATH, JSON.stringify(store, null, 2));
  return result;
}
