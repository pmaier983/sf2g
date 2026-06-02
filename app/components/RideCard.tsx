import type { Ride, RouteCategory } from '../lib/database.types'
import { RouteTag } from './RouteTag'
import { useUnit } from '../lib/useUnit'
import { formatDistance, formatElevation, formatSpeed } from '../lib/leaderboard-utils'

/**
 * RideCard — displays individual ride details.
 */
export function RideCard({ ride }: { ride: Ride }) {
  const unit = useUnit()
  const distanceDisplay = ride.distance_meters
    ? formatDistance(ride.distance_meters, unit)
    : '—'
  const elevationDisplay = ride.elevation_gain_meters
    ? formatElevation(ride.elevation_gain_meters, unit)
    : '—'

  const movingTime = ride.moving_time_seconds
    ? formatDuration(ride.moving_time_seconds)
    : '—'

  const speedDisplay = ride.average_speed_mps
    ? formatSpeed(ride.average_speed_mps, unit)
    : '—'

  const rideDate = new Date(ride.ride_date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <div className="ride-card">
      <div className="ride-card__info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
          <span className="ride-card__name">{ride.name ?? 'Untitled Ride'}</span>
          {ride.route_category && (
            <RouteTag category={ride.route_category as RouteCategory} />
          )}
        </div>
        <p className="ride-card__date">{rideDate}</p>
        <div className="ride-card__stats">
          <span className="ride-card__stat">
            <span className="ride-card__stat-value">{distanceDisplay}</span>
          </span>
          <span className="ride-card__stat">
            <span className="ride-card__stat-value">{movingTime}</span>
          </span>
          <span className="ride-card__stat">
            <span className="ride-card__stat-value">{speedDisplay}</span>
          </span>
          <span className="ride-card__stat">
            <span className="ride-card__stat-value">{elevationDisplay}</span> ↑
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Format seconds into h:mm:ss or mm:ss.
 */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}
