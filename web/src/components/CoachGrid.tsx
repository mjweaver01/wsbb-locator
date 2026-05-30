import type { Coach } from "@/lib/types";
import { TIER_LABELS, TIER_ORDER } from "@/lib/tiers";
import { CoachCard } from "./CoachCard";

interface CoachGridProps {
  coaches: Coach[];
  activeTier: string;
  cardRefs: Map<number, HTMLElement>;
}

export function CoachGrid({ coaches, activeTier, cardRefs }: CoachGridProps) {
  if (coaches.length === 0) {
    return (
      <div className="coach-empty">
        <p className="coach-empty__heading">No coaches found</p>
        <p className="coach-empty__sub">
          Try adjusting your filters or search term.
        </p>
      </div>
    );
  }

  const tiersToShow =
    activeTier === "all"
      ? TIER_ORDER
      : TIER_ORDER.filter((t) => t === activeTier);

  return (
    <div className="coach-directory">
      {tiersToShow.map((tier) => {
        const group = coaches.filter((c) => c.tier === tier);
        if (group.length === 0) return null;
        return (
          <section key={tier} className="coach-section">
            <div className="coach-section__header">
              <span className="coach-section__title">
                {TIER_LABELS[tier].section}
              </span>
              <div className="coach-section__line" />
            </div>
            <div className="coach-grid">
              {group.map((coach) => (
                <CoachCard
                  key={coach.thinkificUserId}
                  coach={coach}
                  cardRef={(el) => {
                    if (el) cardRefs.set(coach.thinkificUserId, el);
                    else cardRefs.delete(coach.thinkificUserId);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
