/**
 * Pull completed pathway enrollments from Thinkific and
 * save the results to coaches-raw.json as a static fallback cache.
 *
 * Run:  bun run fetch
 *
 * Env vars required (.env):
 *   THINKIFIC_API_KEY       – from Thinkific Admin → Settings → API
 *   THINKIFIC_SUBDOMAIN     – e.g. "westside-barbell"
 *
 * Env vars optional (run once without them to see all course IDs):
 *   THINKIFIC_LEVEL1_ID
 *   THINKIFIC_LEVEL2_ID
 *   THINKIFIC_LEVEL3_ID
 */

import { writeFileSync } from "fs";
import { resolve } from "path";
import { fetchCoachesFromThinkific } from "../lib/thinkific";

const OUT_FILE = resolve(import.meta.dir, "../../data/coaches-raw.json");

try {
  console.log("Fetching coaches from Thinkific...\n");
  const data = await fetchCoachesFromThinkific();

  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));

  console.log(`\nDone! ${data.totalCoaches} coaches saved to ${OUT_FILE}`);
  console.log(`  Master:     ${data.tierBreakdown.master}`);
  console.log(`  Certified:  ${data.tierBreakdown.certified}`);
  console.log(`  Candidate:  ${data.tierBreakdown.candidate}`);
  console.log("\nNext: restart the API or call POST /api/coaches/refresh");
} catch (err) {
  console.error("\nError:", (err as Error).message);
  process.exit(1);
}
