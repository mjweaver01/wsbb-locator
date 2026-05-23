import { MapPin } from 'lucide-react'

export function MapPlaceholder() {
  return (
    <div className="map-placeholder">
      <div className="map-placeholder__content">
        <div className="map-placeholder__icon">
          <MapPin size={32} strokeWidth={1.5} />
        </div>
        <p className="map-placeholder__heading">Coach Location Map</p>
        <p className="map-placeholder__note">
          Location data is not included in the Thinkific export.
          Coaches will appear on the map once they add their city and state to their profile.
        </p>
      </div>
    </div>
  )
}
