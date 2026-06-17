/**
 * Tier ordering shared by the API and the web SPA. Display labels and colors
 * are presentation concerns and live in the web app (`web/src/lib/tiers.ts`).
 */
import type { CoachTier, RawCertification } from "./coach";

/** Display order, highest tier first (directory sections, legend, map z-order). */
export const TIER_ORDER: readonly CoachTier[] = [
  "master",
  "certified",
  "candidate",
];

/**
 * Precedence rank — higher wins when a coach qualifies for multiple pathway
 * levels. The API uses this to pick a coach's headline tier; the web app uses
 * it to paint higher tiers above lower ones on the map.
 */
export const TIER_RANK: Record<CoachTier, number> = {
  candidate: 1,
  certified: 2,
  master: 3,
};

/**
 * Pathway levels a coach must complete to become a certified Conjugate Method
 * Coach. Anything short of the full set leaves them a `candidate`.
 */
export const REQUIRED_CERT_LEVELS: readonly number[] = [1, 2, 3];

/**
 * Derive a coach's *earned* tier from their completed certifications. Returns
 * `certified` only when every required level is present; otherwise `candidate`.
 *
 * Note: `master` is never derived here — it's an honorary status granted by
 * admins on top of the earned tier (see `mergeCoachOverrides`).
 */
export function deriveTier(
  certifications: readonly RawCertification[],
): Exclude<CoachTier, "master"> {
  const completedLevels = new Set(certifications.map((c) => c.level));
  const isCertified = REQUIRED_CERT_LEVELS.every((level) =>
    completedLevels.has(level),
  );
  return isCertified ? "certified" : "candidate";
}
