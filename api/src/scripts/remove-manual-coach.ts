/**
 * Remove a manually-managed "house" coach (added via add-manual-coach.ts),
 * keyed by email (case-insensitive).
 *
 * Usage:
 *   bun run api/src/scripts/remove-manual-coach.ts <email>
 *
 * Example:
 *   bun run api/src/scripts/remove-manual-coach.ts tom@westside-barbell.com
 *
 * Targets whatever DB the env points at (sqlite locally, Postgres when
 * DATABASE_URL is set). Note `db-sync.ts push` is upsert-only and never
 * deletes, so to drop a coach from production run this against the live DB
 * directly (e.g. via `railway run`). Afterwards refresh the cache: restart the
 * API or `POST /api/coaches/refresh`.
 */
import { deleteManualCoach, listManualCoaches } from "../lib/db/manual-coaches";

const [email] = process.argv.slice(2);

if (!email) {
  console.error("Usage: bun run api/src/scripts/remove-manual-coach.ts <email>");
  process.exit(1);
}

try {
  const normalized = email.trim().toLowerCase();
  const before = await listManualCoaches();
  const match = before.find((c) => c.email.toLowerCase() === normalized);
  if (!match) {
    console.error(`No manual coach found with email <${normalized}>. Nothing removed.`);
    process.exit(1);
  }

  await deleteManualCoach(normalized);
  console.log(`✓ Removed ${match.fullName} <${match.email}> (${match.tier}).`);
} catch (err) {
  console.error("Error:", (err as Error).message);
  process.exit(1);
}
