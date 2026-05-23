import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { RawCoach } from '@/lib/types'

interface CoachMapProps {
  coaches: RawCoach[]
  onPinClick?: (id: number) => void
}

const TIER_COLORS: Record<string, string> = {
  master:     '#c8a96e',
  instructor: '#c0bdb8',
  certified:  '#a8a49c',
}

function makePinSvg(color: string): string {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
        fill="${color}" stroke="#0a0a0a" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#0a0a0a" opacity="0.6"/>
    </svg>
  `)
}

type LocatedCoach = RawCoach & { lat: number; lng: number }

function addMarkers(
  L: typeof import('leaflet'),
  map: import('leaflet').Map,
  coaches: LocatedCoach[],
  onPinClick?: (id: number) => void,
) {
  coaches.forEach(coach => {
    const color = TIER_COLORS[coach.tier] ?? '#a8a49c'
    const icon = L.icon({
      iconUrl: `data:image/svg+xml,${makePinSvg(color)}`,
      iconSize: [24, 32],
      iconAnchor: [12, 32],
      popupAnchor: [0, -34],
    })

    const popup = L.popup({
      className: 'coach-map-popup',
      closeButton: false,
      maxWidth: 220,
    }).setContent(`
      <div class="map-popup">
        <p class="map-popup__name">${coach.fullName}</p>
        <span class="map-popup__tier map-popup__tier--${coach.tier}">${coach.tier}</span>
        ${coach.city ? `<p class="map-popup__loc">${coach.city}, ${coach.state ?? ''}</p>` : ''}
      </div>
    `)

    L.marker([coach.lat, coach.lng], { icon })
      .addTo(map)
      .bindPopup(popup)
      .on('click', () => onPinClick?.(coach.thinkificUserId))
  })
}

export function CoachMap({ coaches, onPinClick }: CoachMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const [active, setActive] = useState(false)

  const coachesWithLocation = coaches.filter(
    (c): c is LocatedCoach =>
      typeof c.lat === 'number' && typeof c.lng === 'number',
  )

  useEffect(() => {
    if (!containerRef.current) return

    import('leaflet').then(L => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }

      const map = L.map(containerRef.current!, {
        center: [38.5, -96],
        zoom: 4,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      })

      mapRef.current = map

      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 19,
        },
      ).addTo(map)

      addMarkers(L, map, coachesWithLocation, onPinClick)
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      const map = mapRef.current!
      map.eachLayer(layer => {
        if (layer instanceof L.Marker) map.removeLayer(layer)
      })
      addMarkers(L, map, coachesWithLocation, onPinClick)
    })
  }, [coaches]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enable / disable scroll zoom based on overlay state
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (active) {
      map.scrollWheelZoom.enable()
    } else {
      map.scrollWheelZoom.disable()
    }
  }, [active])

  if (coachesWithLocation.length === 0) {
    return (
      <div className="map-placeholder">
        <div className="map-placeholder__content">
          <div className="map-placeholder__icon">
            <MapPin size={32} strokeWidth={1.5} />
          </div>
          <p className="map-placeholder__heading">No locations to display</p>
          <p className="map-placeholder__note">
            None of the currently filtered coaches have location data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="coach-map-wrapper" onMouseLeave={() => setActive(false)}>
      <div ref={containerRef} className="coach-map" />
      {!active && (
        <div className="coach-map-overlay" onClick={() => setActive(true)}>
          <span className="coach-map-overlay__hint">Click to interact with map</span>
        </div>
      )}
    </div>
  )
}
