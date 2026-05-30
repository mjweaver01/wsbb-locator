import type { CoachTier } from "@shared/coach";

// The SPA consumes the canonical coach contract straight from the shared
// package. UI-only view models (filter state, etc.) live here.
export type {
  Coach,
  CoachesPayload,
  CoachTier,
  RawCertification,
  CoachEmailLink,
  MeResponse,
} from "@shared/coach";

export type TierFilter = CoachTier | "all";

export interface FilterState {
  tier: TierFilter;
  search: string;
}
