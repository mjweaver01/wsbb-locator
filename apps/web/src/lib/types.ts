export type CoachTier = "certified" | "instructor" | "master";

export interface RawCertification {
  level: number;
  courseId: number;
  completedAt: string | null;
}

export interface RawCoach {
  thinkificUserId: number;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  tier: CoachTier;
  certifications: RawCertification[];
  // Location — not in the Thinkific export; added via coach profiles or demo data
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

export interface CoachesRawJson {
  fetchedAt: string;
  subdomain: string;
  totalCoaches: number;
  tierBreakdown: {
    master: number;
    instructor: number;
    certified: number;
  };
  coaches: RawCoach[];
}

export type TierFilter = CoachTier | "all";

export interface FilterState {
  tier: TierFilter;
  search: string;
}
