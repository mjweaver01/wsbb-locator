import type { CoachTier } from "@/lib/types";

const TIERS: { tier: CoachTier; label: string }[] = [
  { tier: "master", label: "Master Instructor" },
  { tier: "instructor", label: "Instructor" },
  { tier: "certified", label: "Certified Coach" },
];

export function TierLegend() {
  return (
    <div className="tier-legend">
      <div className="tier-legend__inner">
        <span className="tier-legend__label">Tiers</span>
        <div className="tier-legend__items">
          {TIERS.map(({ tier, label }) => (
            <span key={tier} className={`tier-badge tier-badge--${tier}`}>
              <span className={`tier-badge__dot tier-badge__dot--${tier}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
