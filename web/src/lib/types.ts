import type { Coach, CoachesPayload, CoachTier } from "@shared/coach";

// The SPA consumes the canonical coach contract from the shared package.
// `RawCoach` / `CoachesRawJson` are kept as aliases so existing component
// imports stay stable.
export type {
  Coach,
  CoachTier,
  RawCertification,
  CoachEmailLink,
  MeResponse,
} from "@shared/coach";

export type RawCoach = Coach;
export type CoachesRawJson = CoachesPayload;

export type TierFilter = CoachTier | "all";

export interface FilterState {
  tier: TierFilter;
  search: string;
}
