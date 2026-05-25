import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import 'leaflet/dist/leaflet.css'
import type { CoachesRawJson, FilterState, RawCoach } from '@/lib/types'
import { HeroSection } from '@/components/HeroSection'
import { TierLegend } from '@/components/TierLegend'
import { CoachMap } from '@/components/CoachMap'
import { FilterBar } from '@/components/FilterBar'
import { CoachGrid } from '@/components/CoachGrid'
import { FooterCta } from '@/components/FooterCta'
import { ErrorState, LoadingState } from '@/components/AppState'

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const DATA_URL = `${API_BASE}/api/coaches`
const COACH_PATHWAY_URL =
  import.meta.env.VITE_COACH_PATHWAY_URL ??
  'https://www.westside-barbell.com/pages/conjugate-coach-certification'

const DEFAULT_FILTERS: FilterState = { tier: 'all', search: '' }

function normalise(s: string) {
  return s.toLowerCase().trim()
}

function hasLocation(c: RawCoach) {
  return typeof c.lat === 'number' && typeof c.lng === 'number'
}

export function LandingPage() {
  const [coaches, setCoaches] = useState<RawCoach[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const cardRefs = useRef<Map<number, HTMLElement>>(new Map())

  useEffect(() => {
    fetch(DATA_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load coach data (${r.status})`)
        return r.json() as Promise<CoachesRawJson>
      })
      .then(data => setCoaches(data.coaches))
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo<RawCoach[]>(() => {
    let result = coaches
    if (filters.tier !== 'all') {
      result = result.filter(c => c.tier === filters.tier)
    }
    const q = normalise(filters.search)
    if (q) {
      result = result.filter(c => normalise(c.fullName).includes(q))
    }
    return result
  }, [coaches, filters])

  // Defer the coach set passed to the map so rapid typing doesn't block on
  // marker rebuilds — the input + grid update immediately, the map catches up.
  const mapCoaches = useDeferredValue(filtered)
  const filteredHasLocation = useMemo(
    () => filtered.some(hasLocation),
    [filtered],
  )

  if (loading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState message={error} />
  }

  return (
    <>
      <HeroSection />
      <TierLegend />
      <CoachMap
        coaches={mapCoaches}
        hasLocationHint={filteredHasLocation}
      />
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        visibleCount={filtered.length}
        totalCount={coaches.length}
        level1Url={COACH_PATHWAY_URL}
      />
      <CoachGrid coaches={filtered} activeTier={filters.tier} cardRefs={cardRefs.current} />
      <FooterCta pathwayUrl={COACH_PATHWAY_URL} />
    </>
  )
}
