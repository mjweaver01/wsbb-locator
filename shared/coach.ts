/**
 * Canonical coach domain types shared by the API and the web SPA.
 *
 * This is the single source of truth for the FE/BE wire contract. The API
 * builds these shapes (see `api/src/lib/thinkific.ts`) and the SPA consumes
 * them; neither side should redefine them locally.
 */

export type CoachTier = "certified" | "instructor" | "master";

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
  tierBreakdown: { master: number; instructor: number; certified: number };
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
