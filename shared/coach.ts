/**
 * Canonical coach domain types shared by the API and the web SPA.
 *
 * This is the single source of truth for the FE/BE wire contract. The API
 * builds these shapes (see `api/src/lib/thinkific.ts`) and the SPA consumes
 * them; neither side should redefine them locally.
 */

/**
 * A coach's standing in the directory:
 * - `candidate` — completed at least one pathway course but not the full set.
 * - `certified` — completed every pathway level (Level 1, 2 and 3): a
 *   certified Conjugate Method Coach.
 * - `instructor` — Instructor. Admin-granted only; sits above certified coaches.
 * - `master` — Master Instructor. Admin-granted only; sits above instructors.
 * - `founder` — Pathway Founder. Admin-granted only; the top tier.
 */
export type CoachTier = "candidate" | "certified" | "instructor" | "master" | "founder";

export interface RawCertification {
  level: number;
  courseId: number;
  completedAt: string | null;
}

export interface Coach {
  thinkificUserId: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  company: string | null;
  tier: CoachTier;
  certifications: RawCertification[];
  // Location — not in the Thinkific export; added via coach profiles, company
  // geocoding, or demo data.
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
  // How city/state/lat/lng were resolved. "company-geocode" means derived from
  // the Thinkific company field — a best-effort guess a coach override can
  // replace. Absent when location came from an override or isn't set.
  locationSource?: "company-geocode";
}

export interface CoachesPayload {
  fetchedAt: string;
  subdomain: string;
  totalCoaches: number;
  tierBreakdown: { founder: number; master: number; instructor: number; certified: number; candidate: number };
  coaches: Coach[];
}

export interface CoachEmailLink {
  thinkificUserId: number;
  email: string;
  source: string;
  createdAt: string;
}

export interface MeResponse {
  coach: Coach;
  emailLinks: CoachEmailLink[];
}
