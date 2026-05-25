import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { MapPin } from "lucide-react";
import type { RawCoach } from "@/lib/types";

interface CoachMapProps {
  coaches: RawCoach[];
  hasLocationHint?: boolean;
}

const TIER_COLORS: Record<string, string> = {
  master: "#c8a96e",
  instructor: "#c0bdb8",
  certified: "#a8a49c",
};

// Cache the leaflet module so we only pay the dynamic-import cost once,
// not on every keystroke in the search box.
let leafletPromise: Promise<typeof Leaflet> | null = null;
function loadLeaflet() {
  if (!leafletPromise) leafletPromise = import("leaflet");
  return leafletPromise;
}

function makePinSvg(color: string): string {
  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
        fill="${color}" stroke="#0a0a0a" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#0a0a0a" opacity="0.6"/>
    </svg>
  `);
}

// Cache one icon per tier — every marker of the same tier shares one icon
// instead of allocating a fresh L.Icon (and SVG data URL) per pin.
const iconCache = new Map<string, Leaflet.Icon>();
function getIcon(L: typeof Leaflet, tier: string): Leaflet.Icon {
  const cached = iconCache.get(tier);
  if (cached) return cached;
  const color = TIER_COLORS[tier] ?? "#a8a49c";
  const icon = L.icon({
    iconUrl: `data:image/svg+xml,${makePinSvg(color)}`,
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -34],
  });
  iconCache.set(tier, icon);
  return icon;
}

type LocatedCoach = RawCoach & { lat: number; lng: number };

function hasLocation(c: RawCoach): c is LocatedCoach {
  return typeof c.lat === "number" && typeof c.lng === "number";
}

function formatTierLabel(tier: string): string {
  if (!tier) return "";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function CoachMap({ coaches, hasLocationHint = false }: CoachMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const [active, setActive] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const coachesWithLocation = useMemo(
    () => coaches.filter(hasLocation),
    [coaches],
  );
  const hasLocations = coachesWithLocation.length > 0;
  const showNoLocations = !hasLocations && !hasLocationHint;

  // Init the map once, on mount. The wrapper is always rendered (we toggle
  // the "no locations" state as an inner overlay) so containerRef stays stable
  // and Leaflet doesn't end up pointing at a detached node after filtering.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let loadFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;

      setMapLoaded(false);

      const map = L.map(containerRef.current, {
        center: [38.5, -96],
        zoom: 4,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      });

      const tiles = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        },
      );

      tiles.once("load", () => {
        if (!cancelled) setMapLoaded(true);
      });

      // Defensive fallback: if the tile provider is slow, avoid a permanent
      // loading mask and let the user see/interact with the map shell.
      loadFallbackTimer = setTimeout(() => {
        if (!cancelled) setMapLoaded(true);
      }, 1500);

      tiles.addTo(map);

      markerLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      if (loadFallbackTimer) clearTimeout(loadFallbackTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  // Sync markers to the current coach set. Uses one LayerGroup we clear and
  // refill — O(n) DOM work in a single pass rather than per-keystroke
  // eachLayer + instanceof + N individual removeLayer calls.
  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled) return;
      const map = mapRef.current;
      const group = markerLayerRef.current;
      if (!map || !group) return;

      group.clearLayers();

      for (const coach of coachesWithLocation) {
        const marker = L.marker([coach.lat, coach.lng], {
          icon: getIcon(L, coach.tier),
        });
        const listingHref = `#coach-${coach.thinkificUserId}`;
        marker.bindPopup(
          `
            <div class="map-popup">
              <p class="map-popup__name">${coach.fullName}</p>
              <span class="map-popup__tier map-popup__tier--${coach.tier}">${formatTierLabel(coach.tier)}</span>
              ${coach.city ? `<p class="map-popup__loc">${coach.city}, ${coach.state ?? ""}</p>` : ""}
              <a class="map-popup__listing-link" href="${listingHref}">
                View Listing
              </a>
            </div>
          `,
          { className: "coach-map-popup", closeButton: false, maxWidth: 240 },
        );
        group.addLayer(marker);
      }

      // Defensive — if a parent layout shift changed our height, make sure
      // Leaflet recomputes its panes inside the wrapper.
      map.invalidateSize({ animate: false });
    });

    return () => {
      cancelled = true;
    };
  }, [coachesWithLocation]);

  // Recompute pane sizes on window resize so panes always match the wrapper.
  useEffect(() => {
    function onResize() {
      mapRef.current?.invalidateSize({ animate: false });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
  }, [active]);

  return (
    <div className="coach-map-wrapper" onMouseLeave={() => setActive(false)}>
      <div ref={containerRef} className="coach-map" />

      {!mapLoaded && (
        <div className="coach-map-loading" aria-hidden="true">
          <span className="coach-map-loading__label">Loading map…</span>
        </div>
      )}

      {showNoLocations && (
        <div className="coach-map-empty" role="status">
          <div className="coach-map-empty__content">
            <div className="coach-map-empty__icon">
              <MapPin size={28} strokeWidth={1.5} />
            </div>
            <p className="coach-map-empty__heading">No locations to display</p>
            <p className="coach-map-empty__note">
              None of the currently filtered coaches have location data.
            </p>
          </div>
        </div>
      )}

      {hasLocations && !active && (
        <div className="coach-map-overlay" onClick={() => setActive(true)}>
          <span className="coach-map-overlay__hint">
            Click to interact with map
          </span>
        </div>
      )}
    </div>
  );
}
