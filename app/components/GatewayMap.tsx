import { ROUTE_GATEWAYS, ROUTE_COLORS, ROUTE_LABELS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'

/**
 * GatewayMap — CSS-based visual diagram showing relative positions
 * of all 8 gateway checkpoints.
 *
 * Maps lat/lng to CSS percentages based on bounding box of gateway coords.
 */
export function GatewayMap() {
  // Compute bounding box from gateway coordinates
  const lats = ROUTE_GATEWAYS.map((g) => g.lat)
  const lngs = ROUTE_GATEWAYS.map((g) => g.lng)

  const minLat = Math.min(...lats) - 0.02
  const maxLat = Math.max(...lats) + 0.02
  const minLng = Math.min(...lngs) - 0.02
  const maxLng = Math.max(...lngs) + 0.02

  const latRange = maxLat - minLat
  const lngRange = maxLng - minLng

  // Convert lat/lng to CSS percentage position
  // Note: latitude increases going north (up), so we invert Y
  const toPosition = (lat: number, lng: number) => ({
    top: `${((maxLat - lat) / latRange) * 100}%`,
    left: `${((lng - minLng) / lngRange) * 100}%`,
  })

  const uniqueCategories: RouteCategory[] = ['hmbw', 'skyline', 'bayway', 'royale']

  return (
    <div className="gateway-map glass-card">
      <h3 className="gateway-map__title">Gateway Overview</h3>
      <div className="gateway-map__container">
        {/* Direction labels */}
        <span className="gateway-map__sf-label">↑ San Francisco</span>
        <span className="gateway-map__peninsula-label">Peninsula ↓</span>

        {/* Gateway points */}
        {ROUTE_GATEWAYS.map((gw) => {
          const pos = toPosition(gw.lat, gw.lng)
          const color = ROUTE_COLORS[gw.category]

          return (
            <div key={gw.name}>
              <div
                className="gateway-map__point"
                style={{
                  ...pos,
                  backgroundColor: color,
                }}
                title={`${gw.name}\n${gw.lat.toFixed(4)}°N, ${Math.abs(gw.lng).toFixed(4)}°W`}
              />
              <span
                className="gateway-map__label"
                style={{
                  top: `calc(${pos.top} + 10px)`,
                  left: pos.left,
                }}
              >
                {gw.name.split('(')[0].trim()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="gateway-map__legend">
        {uniqueCategories.map((cat) => (
          <div key={cat} className="gateway-map__legend-item">
            <span
              className="gateway-map__legend-dot"
              style={{ backgroundColor: ROUTE_COLORS[cat] }}
            />
            {ROUTE_LABELS[cat]}
          </div>
        ))}
      </div>
    </div>
  )
}
