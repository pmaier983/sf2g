/**
 * WindProfile — Wind visualization along the route.
 *
 * Shows SVG arrows at each waypoint indicating wind direction,
 * color-coded: green (tailwind) → yellow (crosswind) → red (headwind).
 * Calculates bearing between consecutive waypoints to determine
 * headwind/tailwind component.
 */
import type { RouteWeatherPoint } from '../server/forecast'
import { Tooltip } from './Tooltip'

interface WindProfileProps {
  waypoints: RouteWeatherPoint[]
}

/**
 * Calculate compass bearing from point A to point B.
 */
function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const lat1Rad = (lat1 * Math.PI) / 180
  const lat2Rad = (lat2 * Math.PI) / 180

  const y = Math.sin(dLng) * Math.cos(lat2Rad)
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Get the wind effect color based on the angle between wind direction
 * and travel direction.
 *
 * Wind direction is "from" direction (meteorological). We flip it +180
 * to get the direction the wind pushes toward, then compare with travel bearing.
 */
function getWindColor(
  windDirection: number,
  travelBearing: number,
): { color: string; label: string } {
  // Wind blows FROM windDirection, so it pushes TOWARD windDirection + 180
  const windTo = (windDirection + 180) % 360
  // Angle difference between wind push direction and travel direction
  let diff = Math.abs(windTo - travelBearing)
  if (diff > 180) diff = 360 - diff

  if (diff < 45) return { color: 'var(--color-success)', label: 'Tailwind' }
  if (diff < 90) return { color: '#a3e635', label: 'Quartering tailwind' }
  if (diff < 135) return { color: 'var(--color-warning)', label: 'Crosswind' }
  if (diff < 160) return { color: 'var(--color-sf2g-orange)', label: 'Quartering headwind' }
  return { color: 'var(--color-error)', label: 'Headwind' }
}

/**
 * Compass direction string from degrees.
 */
function compassDir(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

export function WindProfile({ waypoints }: WindProfileProps) {
  if (waypoints.length < 2) return null

  // Calculate travel bearing at each point (using next waypoint)
  const items = waypoints.map((wp, i) => {
    const next = waypoints[Math.min(i + 1, waypoints.length - 1)]
    const travelBearing = bearing(wp.lat, wp.lng, next.lat, next.lng)
    const windInfo = getWindColor(wp.windDirection, travelBearing)

    return {
      ...wp,
      travelBearing,
      windColor: windInfo.color,
      windLabel: windInfo.label,
    }
  })

  return (
    <div className="wind-profile">
      <h3 className="wind-profile__title">💨 Wind Profile</h3>
      <div className="wind-profile__legend">
        <span className="wind-profile__legend-item">
          <span className="wind-profile__legend-dot" style={{ background: 'var(--color-success)' }} />
          Tailwind
        </span>
        <span className="wind-profile__legend-item">
          <span className="wind-profile__legend-dot" style={{ background: 'var(--color-warning)' }} />
          Crosswind
        </span>
        <span className="wind-profile__legend-item">
          <span className="wind-profile__legend-dot" style={{ background: 'var(--color-error)' }} />
          Headwind
        </span>
      </div>
      <div className="wind-profile__points">
        {items.map((item) => (
          <Tooltip
            key={item.mile}
            content={`${item.label}: ${item.windSpeed.toFixed(1)} mph from ${compassDir(item.windDirection)} — ${item.windLabel}`}
          >
            <div className="wind-profile__point">
              <svg
                className="wind-profile__arrow"
                viewBox="0 0 32 32"
                width="28"
                height="28"
              >
                {/* Arrow pointing in wind direction (FROM), rotated */}
                <g transform={`rotate(${item.windDirection}, 16, 16)`}>
                  <line
                    x1="16"
                    y1="4"
                    x2="16"
                    y2="26"
                    stroke={item.windColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <polyline
                    points="10,12 16,4 22,12"
                    fill="none"
                    stroke={item.windColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
              <span className="wind-profile__speed" style={{ color: item.windColor }}>
                {Math.round(item.windSpeed)}
              </span>
              <span className="wind-profile__label">{item.label.split('/')[0].trim()}</span>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
