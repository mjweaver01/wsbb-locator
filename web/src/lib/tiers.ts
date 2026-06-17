import type { CoachTier } from "@shared/coach";
import { TIER_ORDER, TIER_RANK } from "@shared/tiers";

// Re-exported so UI components import tier presentation + ordering from one
// place. Ordering itself is the shared domain constant.
export { TIER_ORDER };

interface TierLabels {
  /** Badge / legend label, e.g. "Master Instructor". */
  badge: string;
  /** Directory section heading (plural), e.g. "Master Instructors". */
  section: string;
  /** Compact filter-button label, e.g. "Master". */
  short: string;
}

export const TIER_LABELS: Record<CoachTier, TierLabels> = {
  master: {
    badge: "Master Instructor",
    section: "Master Instructors",
    short: "Master",
  },
  certified: {
    badge: "Certified Coach",
    section: "Certified Coaches",
    short: "Certified",
  },
  candidate: {
    badge: "Coach Candidate",
    section: "Coach Candidates",
    short: "Candidate",
  },
};

export const TIER_COLORS: Record<CoachTier, string> = {
  master: "#c8a96e",
  certified: "#a8a49c",
  candidate: "#c0bdb8",
};

// Higher tiers paint above lower ones when map pins overlap. Derived from the
// shared precedence rank so there's a single source of truth for ordering.
export const TIER_Z_INDEX: Record<CoachTier, number> = {
  candidate: (TIER_RANK.candidate - 1) * 100,
  certified: (TIER_RANK.certified - 1) * 100,
  master: (TIER_RANK.master - 1) * 100,
};

export const LEVEL_LABEL: Record<number, string> = {
  1: "Level 1",
  2: "Level 2",
  3: "Level 3",
};
