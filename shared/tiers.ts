/**
 * Tier ordering shared by the API and the web SPA. Display labels and colors
 * are presentation concerns and live in the web app (`web/src/lib/tiers.ts`).
 */
import type { CoachTier } from "./coach";

/** Display order, highest tier first (directory sections, legend, map z-order). */
export const TIER_ORDER: readonly CoachTier[] = [
  "master",
  "instructor",
  "certified",
];

/**
 * Precedence rank — higher wins when a coach qualifies for multiple pathway
 * levels. The API uses this to pick a coach's headline tier; the web app uses
 * it to paint higher tiers above lower ones on the map.
 */
export const TIER_RANK: Record<CoachTier, number> = {
  certified: 1,
  instructor: 2,
  master: 3,
};
