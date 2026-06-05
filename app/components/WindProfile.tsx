/**
 * WindProfile — Wind visualization along the route.
 *
 * Shows SVG arrows at each waypoint indicating wind direction,
 * color-coded: green (tailwind) → yellow (crosswind) → red (headwind).
 * Uses the server-computed travelBearing and headwindComponent for
 * consistency with the RideRecommendation stats.
 */
import type { RouteWeatherPoint } from '../server/forecast'
import { Tooltip } from './Tooltip'

interface WindProfileProps {
  waypoints: RouteWeatherPoint[]
}

/**
 * Get the wind effect color based on the headwind component value
 * computed by the server (positive = headwind, negative = tailwind).
 *
 * This ensures consistency with RideRecommendation which uses the
 * same server-computed avgHeadwind value.
 */
function getWindColor(headwindComponent: number): { color: string; label: string } {
  if (headwindComponent < -5) return { color: 'var(--color-success)', label: 'Tailwind' }
  if (headwindComponent < -2) return { color: '#a3e635', label: 'Quartering tailwind' }
  if (headwindComponent < 2) return { color: 'var(--color-warning)', label: 'Crosswind' }
  if (headwindComponent < 5) return { color: 'var(--color-sf2g-orange)', label: 'Quartering headwind' }
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

  // Use server-computed headwindComponent and travelBearing directly
  const items = waypoints.map((wp) => {
    const windInfo = getWindColor(wp.headwindComponent)
    return {
      ...wp,
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
