import { TIER_LABELS, TIER_ORDER } from "@/lib/tiers";

export function TierLegend() {
  return (
    <div className="tier-legend">
      <div className="tier-legend__inner">
        <span className="tier-legend__label">Tiers</span>
        <div className="tier-legend__items">
          {TIER_ORDER.map((tier) => (
            <span key={tier} className={`tier-badge tier-badge--${tier}`}>
              <span className={`tier-badge__dot tier-badge__dot--${tier}`} />
              {TIER_LABELS[tier].badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
