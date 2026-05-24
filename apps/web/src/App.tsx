import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle } from 'lucide-react'
import type { CoachesRawJson, FilterState, RawCoach } from '@/lib/types'
import { HeroSection } from '@/components/HeroSection'
import { TierLegend } from '@/components/TierLegend'
import { CoachMap } from '@/components/CoachMap'
import { FilterBar } from '@/components/FilterBar'
import { CoachGrid } from '@/components/CoachGrid'

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const DATA_URL = `${API_BASE}/api/coaches`

const DEFAULT_FILTERS: FilterState = { tier: 'all', search: '' }

function normalise(s: string) {
  return s.toLowerCase().trim()
}

export function App() {
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

  function handlePinClick(id: number) {
    const el = cardRefs.current.get(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('coach-card--highlight')
      setTimeout(() => el.classList.remove('coach-card--highlight'), 1200)
    }
  }

  if (loading) {
    return (
      <>
        <HeroSection />
        <div className="loading-state">Loading coaches…</div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <HeroSection />
        <div className="error-state">
          <AlertTriangle size={20} strokeWidth={1.5} />
          <span>{error}</span>
          <span style={{ fontSize: 12 }}>
            Make sure coaches-raw.json is in apps/web/public/
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <HeroSection />
      <TierLegend />
      <CoachMap coaches={mapCoaches} onPinClick={handlePinClick} />
      <FilterBar
        filters={filters}
        onFiltersChange={setFilters}
        visibleCount={filtered.length}
        totalCount={coaches.length}
      />
      <CoachGrid coaches={filtered} activeTier={filters.tier} cardRefs={cardRefs.current} />
      <FooterCta />
    </>
  )
}

function FooterCta() {
  return (
    <footer className="footer-cta">
      <p className="footer-cta__eyebrow">Join the Directory</p>
      <h2 className="footer-cta__heading">
        Complete the
        <br />
        Pathway
      </h2>
      <p className="footer-cta__sub">
        Earn your WSBB certification and get listed alongside the world's top
        conjugate coaches.
      </p>
      <a
        href="https://westsidebarbell.thinkific.com"
        target="_blank"
        rel="noopener noreferrer"
        className="footer-cta__btn"
      >
        Start Level 1 →
      </a>
    </footer>
  )
}
