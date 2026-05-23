/**
 * Step 1 of 2: Pull completed pathway enrollments from Thinkific
 * and save the results to coaches-raw.json for inspection / seeding.
 *
 * Run:  bun run fetch
 *
 * Env vars required (.env):
 *   THINKIFIC_API_KEY       – from Thinkific Admin → Settings → API
 *   THINKIFIC_SUBDOMAIN     – e.g. "westsidebarbell"
 *
 * Env vars optional (run once without them to see all course IDs):
 *   THINKIFIC_LEVEL1_ID
 *   THINKIFIC_LEVEL2_ID
 *   THINKIFIC_LEVEL3_ID
 */

import { writeFileSync } from "fs";
import { fetchCoachesFromThinkific } from "../lib/thinkific";

const OUT_FILE = "apps/web/public/coaches-raw.json";

try {
  console.log("Fetching coaches from Thinkific...\n");
  const data = await fetchCoachesFromThinkific();

  writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));

  console.log(`\nDone! ${data.totalCoaches} coaches saved to ${OUT_FILE}`);
  console.log(`  Master:     ${data.tierBreakdown.master}`);
  console.log(`  Instructor: ${data.tierBreakdown.instructor}`);
  console.log(`  Certified:  ${data.tierBreakdown.certified}`);
  console.log("\nNext: bun run seed");
} catch (err) {
  console.error("\nError:", (err as Error).message);
  process.exit(1);
}
