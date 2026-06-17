/**
 * Rebuild the Thinkific coach cache directly against the configured DB.
 *
 * Use this instead of the HTTP `POST /api/coaches/resync` endpoint when a full
 * Thinkific fetch runs longer than the platform's HTTP request timeout (e.g.
 * Railway's edge returns 502 before the sync finishes). This does the same work
 * out-of-band, then you bust the live server's in-memory cache with
 * `POST /api/coaches/refresh`.
 *
 * Needs THINKIFIC_* creds and DATABASE_URL in the environment.
 *
 * Usage:
 *   bun run api/src/scripts/resync-thinkific.ts
 */
import { resyncFromThinkific } from "../lib/coaches-cache";

try {
  console.log("Resyncing from Thinkific (this can take a couple of minutes)…");
  const data = await resyncFromThinkific();
  console.log(`✓ resynced ${data.totalCoaches} coaches`);
  console.log(`  breakdown: ${JSON.stringify(data.tierBreakdown)}`);
  console.log("Next: POST /api/coaches/refresh to refresh the live cache.");
  process.exit(0);
} catch (err) {
  console.error("Error:", (err as Error).message);
  process.exit(1);
}
