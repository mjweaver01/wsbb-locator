import { useState } from "react";
import type { Coach } from "@/lib/types";
import { TIER_LABELS, TIER_ORDER } from "@/lib/tiers";
import { CoachCard } from "./CoachCard";

interface CoachGridProps {
  coaches: Coach[];
  activeTier: string;
  cardRefs: Map<number, HTMLElement>;
}

function CoachCards({
  coaches,
  cardRefs,
}: {
  coaches: Coach[];
  cardRefs: Map<number, HTMLElement>;
}) {
  return (
    <div className="coach-grid">
      {coaches.map((coach) => (
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
  );
}

/**
 * Coach Candidates haven't completed the full pathway, so they're tucked into a
 * collapsed accordion by default to keep the directory focused on certified
 * coaches. Expanded automatically when the visitor explicitly filters to them.
 */
function CandidateAccordion({
  coaches,
  cardRefs,
  defaultOpen,
}: {
  coaches: Coach[];
  cardRefs: Map<number, HTMLElement>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="coach-section coach-section--accordion">
      <button
        type="button"
        className="coach-section__header coach-section__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="coach-section__title">
          {TIER_LABELS.candidate.section}
          <span className="coach-section__count">{coaches.length}</span>
        </span>
        <div className="coach-section__line" />
        <span
          className={`coach-section__chevron${open ? " coach-section__chevron--open" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && <CoachCards coaches={coaches} cardRefs={cardRefs} />}
    </section>
  );
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

        if (tier === "candidate" && activeTier === "all") {
          return (
            <CandidateAccordion
              key={tier}
              coaches={group}
              cardRefs={cardRefs}
              defaultOpen={false}
            />
          );
        }

        return (
          <section key={tier} className="coach-section">
            <div className="coach-section__header">
              <span className="coach-section__title">
                {TIER_LABELS[tier].section}
              </span>
              <div className="coach-section__line" />
            </div>
            <CoachCards coaches={group} cardRefs={cardRefs} />
          </section>
        );
      })}
    </div>
  );
}
