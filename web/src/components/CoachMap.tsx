import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { createRoot, type Root } from "react-dom/client";
import { MapPin } from "lucide-react";
import type { Coach, CoachTier } from "@/lib/types";
import { TIER_COLORS, TIER_Z_INDEX } from "@/lib/tiers";
import { CoachCard } from "./CoachCard";

interface CoachMapProps {
  coaches: Coach[];
  hasLocationHint?: boolean;
}

// Cache the leaflet module so we only pay the dynamic-import cost once,
// not on every keystroke in the search box.
let leafletPromise: Promise<typeof Leaflet> | null = null;
function loadLeaflet() {
  if (!leafletPromise) leafletPromise = import("leaflet");
  return leafletPromise;
}

const PIN_WIDTH = 24;
const PIN_HEIGHT = 32;
// Invisible padding around the pin so clicks match the pointer hover area.
const PIN_HIT_WIDTH = 44;
const PIN_HIT_HEIGHT = 52;

function makePinSvgMarkup(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 20 12 20S24 21 24 12C24 5.37 18.63 0 12 0z"
        fill="${color}" stroke="#0a0a0a" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#0a0a0a" opacity="0.6"/>
    </svg>`;
}

function makePinHtml(color: string): string {
  return `<div class="coach-map-pin">${makePinSvgMarkup(color)}</div>`;
}

// Cache one icon per tier — every marker of the same tier shares one icon
// instead of allocating a fresh L.DivIcon (and SVG markup) per pin.
const iconCache = new Map<CoachTier, Leaflet.DivIcon>();
function getIcon(L: typeof Leaflet, tier: CoachTier): Leaflet.DivIcon {
  const cached = iconCache.get(tier);
  if (cached) return cached;
  const color = TIER_COLORS[tier];
  const icon = L.divIcon({
    className: "coach-map-pin-icon",
    html: makePinHtml(color),
    iconSize: [PIN_HIT_WIDTH, PIN_HIT_HEIGHT],
    iconAnchor: [PIN_HIT_WIDTH / 2, PIN_HIT_HEIGHT],
    popupAnchor: [0, -(PIN_HIT_HEIGHT + 2)],
  });
  iconCache.set(tier, icon);
  return icon;
}

type LocatedCoach = Coach & { lat: number; lng: number };

function hasLocation(c: Coach): c is LocatedCoach {
  return typeof c.lat === "number" && typeof c.lng === "number";
}

export function CoachMap({ coaches, hasLocationHint = false }: CoachMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const [active, setActive] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
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
    const popupRoots: Root[] = [];

    loadLeaflet().then((L) => {
      if (cancelled) return;
      const map = mapRef.current;
      const group = markerLayerRef.current;
      if (!map || !group) return;

      group.clearLayers();

      const sortedCoaches = [...coachesWithLocation].sort(
        (a, b) => TIER_Z_INDEX[a.tier] - TIER_Z_INDEX[b.tier],
      );

      for (const coach of sortedCoaches) {
        const marker = L.marker([coach.lat, coach.lng], {
          icon: getIcon(L, coach.tier),
          zIndexOffset: TIER_Z_INDEX[coach.tier],
          riseOnHover: true,
        });
        const popupContainer = document.createElement("div");
        popupContainer.className = "coach-map-popup-card";
        const popupRoot = createRoot(popupContainer);
        popupRoot.render(<CoachCard coach={coach} includeAnchorId={false} />);
        popupRoots.push(popupRoot);

        marker.bindPopup(popupContainer, {
          className: "coach-map-popup coach-map-popup--card",
          closeButton: false,
          maxWidth: 360,
        });
        group.addLayer(marker);
      }

      // Defensive — if a parent layout shift changed our height, make sure
      // Leaflet recomputes its panes inside the wrapper.
      map.invalidateSize({ animate: false });
    });

    return () => {
      cancelled = true;
      for (const popupRoot of popupRoots) {
        popupRoot.unmount();
      }
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

      {hasLocations && !active && !hasInteracted && (
        <div
          className="coach-map-overlay"
          onClick={() => {
            setActive(true);
            setHasInteracted(true);
          }}
        >
          <span className="coach-map-overlay__hint">
            Click to interact with map
          </span>
        </div>
      )}
    </div>
  );
}
