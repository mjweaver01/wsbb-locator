import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { CoachTier, FilterState, TierFilter } from "@/lib/types";
import { TIER_LABELS, TIER_ORDER } from "@/lib/tiers";

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  visibleCount: number;
  totalCount: number;
  level1Url: string;
  presentTiers: Set<CoachTier>;
}

export function FilterBar({
  filters,
  onFiltersChange,
  visibleCount,
  totalCount,
  level1Url,
  presentTiers,
}: FilterBarProps) {
  const tierButtons: { value: TierFilter; label: string }[] = [
    { value: "all", label: "All" },
    ...TIER_ORDER.filter((tier) => presentTiers.has(tier)).map((tier) => ({
      value: tier as TierFilter,
      label: TIER_LABELS[tier].short,
    })),
  ];

  return (
    <nav className="filter-bar" aria-label="Coach filters">
      <div className="filter-bar__inner">
        <div
          className="filter-bar__tiers"
          role="group"
          aria-label="Filter by tier"
        >
          {tierButtons.map(({ value, label }) => {
            const isActive = filters.tier === value;
            const nextTier: TierFilter =
              value === "all" ? "all" : isActive ? "all" : value;
            return (
              <button
                key={value}
                className={[
                  "filter-btn",
                  `filter-btn--${value}`,
                  isActive ? "filter-btn--active" : "",
                ].join(" ")}
                aria-pressed={isActive}
                onClick={() => onFiltersChange({ ...filters, tier: nextTier })}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="filter-bar__divider" role="separator" />

        <div className="filter-bar__search">
          <span className="filter-bar__search-icon" aria-hidden>
            <Search size={13} strokeWidth={2} />
          </span>
          <input
            type="search"
            placeholder="Search by name…"
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            aria-label="Search coaches by name"
          />
        </div>

        <span className="filter-bar__count">
          <strong>{visibleCount}</strong> / {totalCount} listings
        </span>

        <Link
          to="/coach-access"
          className="filter-bar__cta filter-bar__cta--muted"
        >
          Update Your Listing
        </Link>

        <a
          href={level1Url}
          target="_blank"
          rel="noopener noreferrer"
          className="filter-bar__cta"
        >
          Complete the Pathway →
        </a>
      </div>
    </nav>
  );
}
