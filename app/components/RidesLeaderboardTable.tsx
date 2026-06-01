import { Link } from '@tanstack/react-router'
import type {
  RideLeaderboardEntry,
  RidesLeaderboardResponse,
} from '../lib/database.types'
import {
  formatSpeed,
  formatDistance,
  formatElevation,
  formatRideDate,
  formatMovingTime,
} from '../lib/leaderboard-utils'
import { msToMph } from '../lib/wind'
import { useUnit } from '../lib/useUnit'
import { RouteTag } from './RouteTag'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface RidesLeaderboardTableProps {
  data: RidesLeaderboardResponse | undefined
  isLoading: boolean
  sortBy: string
  sortDir: 'asc' | 'desc'
  onSortChange: (column: string, direction: 'asc' | 'desc') => void
  onPageChange: (page: number) => void
  activeUser?: string | null
  onClearUser?: () => void
}

// ---------------------------------------------------------------------------
// Sortable column definitions
// ---------------------------------------------------------------------------
interface ColumnDef {
  key: string
  label: string
  sortable: boolean
  className?: string
  tooltip: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', sortable: false, className: 'rides-table__rank', tooltip: 'Row number in the current sort order' },
  { key: 'rider', label: 'Rider', sortable: false, tooltip: 'Rider name — click to view their profile' },
  { key: 'name', label: 'Ride Name', sortable: true, tooltip: 'Strava activity name — click header to sort alphabetically' },
  { key: 'ride_date', label: 'Date', sortable: true, tooltip: 'Ride date — click header to sort by date' },
  { key: 'route_category', label: 'Route', sortable: true, tooltip: 'Classified SF2G route corridor (Bayway, Skyline, HMBW, etc.)' },
  { key: 'average_speed_mps', label: 'Avg Speed', sortable: true, tooltip: 'Average moving speed for the ride' },
  { key: 'distance_meters', label: 'Distance', sortable: true, tooltip: 'Total ride distance' },
  { key: 'elevation_gain_meters', label: 'Elevation', sortable: true, tooltip: 'Total elevation gain for the ride' },
  { key: 'moving_time_seconds', label: 'Time', sortable: true, tooltip: 'Total moving time (excludes stopped time)' },
  { key: 'tailwind_component_ms', label: 'Tailwind', sortable: true, tooltip: 'Wind assistance along the ride direction (mph). Green (+) = tailwind pushing you forward. Red (−) = headwind slowing you down. Sourced from Open-Meteo historical weather data.' },
]

const SKELETON_ROWS = 8

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RidesLeaderboardTable({
  data,
  isLoading,
  sortBy,
  sortDir,
  onSortChange,
  onPageChange,
  activeUser,
  onClearUser,
}: RidesLeaderboardTableProps) {
  const rides = data?.rides ?? []
  const totalCount = data?.totalCount ?? 0
  const page = data?.page ?? 1
  const pageSize = data?.pageSize ?? 200

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const startIndex = (page - 1) * pageSize
  const endIndex = Math.min(startIndex + rides.length, totalCount)

  const handleSort = (col: ColumnDef) => {
    if (!col.sortable) return
    if (sortBy === col.key) {
      // Same column: toggle direction
      onSortChange(col.key, sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      // New column: default to descending
      onSortChange(col.key, 'desc')
    }
  }

  const ariaSortValue = (col: ColumnDef): 'ascending' | 'descending' | 'none' => {
    if (sortBy !== col.key) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  // Active user display name (find from first ride that matches)
  const activeUserName =
    activeUser && rides.length > 0
      ? rides.find((r) => r.user_id === activeUser)?.display_name ?? 'Rider'
      : null

  return (
    <div className="rides-table">
      {/* User filter banner */}
      {activeUser && activeUserName && (
        <div className="rides-table__user-banner">
          <span>
            Showing rides for <strong>{activeUserName}</strong>
          </span>
          {onClearUser && (
            <button
              className="rides-table__clear-btn"
              onClick={onClearUser}
              aria-label="Clear rider filter"
            >
              ✕ Clear filter
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rides-table__wrapper">
        <table role="grid" aria-label="Rides leaderboard">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.className}
                  aria-sort={col.sortable ? ariaSortValue(col) : undefined}
                  onClick={() => handleSort(col)}
                  title={col.tooltip}
                  style={col.sortable ? { cursor: 'pointer' } : { cursor: 'help' }}
                >
                  {col.label}
                  {col.sortable && sortBy === col.key && (
                    <span className="sort-indicator">
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : rides.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="rides-table__empty">
                  No rides match the current filters
                </td>
              </tr>
            ) : (
              rides.map((ride, idx) => (
                <RideRow
                  key={ride.id}
                  ride={ride}
                  rank={startIndex + idx + 1}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!isLoading && totalCount > 0 && (
        <div className="rides-table__pagination" aria-live="polite">
          <span className="rides-table__page-info">
            Showing {startIndex + 1}–{endIndex} of{' '}
            {totalCount.toLocaleString()}
          </span>
          <div className="rides-table__page-buttons">
            <button
              className="btn btn--secondary btn--sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Go to previous page"
            >
              ← Previous
            </button>
            <button
              className="btn btn--secondary btn--sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Go to next page"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------
function RideRow({
  ride,
  rank,
}: {
  ride: RideLeaderboardEntry
  rank: number
}) {
  const unit = useUnit()
  return (
    <tr>
      {/* Rank */}
      <td className="rides-table__rank">{rank}</td>

      {/* Rider */}
      <td>
        <div className="rides-table__rider">
          {ride.avatar_url ? (
            <img
              className="rides-table__avatar"
              src={ride.avatar_url}
              alt=""
              loading="lazy"
              width={32}
              height={32}
            />
          ) : (
            <span className="rides-table__avatar-fallback" aria-hidden="true">
              👤
            </span>
          )}
          <Link
            to="/profile/$userId"
            params={{ userId: ride.user_id }}
            className="rides-table__rider-name"
          >
            {ride.display_name ?? 'Unknown Rider'}
          </Link>
        </div>
      </td>

      {/* Ride Name */}
      <td className="rides-table__ride-name" title={ride.name ?? undefined}>
        {ride.strava_activity_id ? (
          <a
            href={`https://www.strava.com/activities/${String(ride.strava_activity_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-rides__strava-link"
          >
            {ride.name ?? '—'}
          </a>
        ) : (
          ride.name ?? '—'
        )}
      </td>

      {/* Date */}
      <td>{formatRideDate(ride.ride_date) ?? '—'}</td>

      {/* Route */}
      <td>
        {ride.route_category ? (
          <RouteTag category={ride.route_category} />
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Avg Speed */}
      <td>{formatSpeed(ride.average_speed_mps, unit)}</td>

      {/* Distance */}
      <td>{formatDistance(ride.distance_meters, unit)}</td>

      {/* Elevation */}
      <td>{formatElevation(ride.elevation_gain_meters, unit)}</td>

      {/* Moving Time */}
      <td>{formatMovingTime(ride.moving_time_seconds)}</td>

      {/* Tailwind */}
      <td>
        {ride.tailwind_component_ms != null ? (
          <span style={{
            color: ride.tailwind_component_ms > 0.5 ? 'var(--color-success)' :
                   ride.tailwind_component_ms < -0.5 ? 'var(--color-error)' :
                   'var(--color-text-muted)',
            fontWeight: 500,
          }}>
            {(() => {
              const mph = msToMph(ride.tailwind_component_ms)
              const sign = mph > 0 ? '+' : ''
              return Math.abs(mph) < 0.5 ? '—' : `${sign}${mph.toFixed(1)}`
            })()}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Skeleton loading rows
// ---------------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <tr key={`skel-${i}`} className="rides-table__skeleton-row">
          {COLUMNS.map((col) => (
            <td key={col.key}>
              <div className="rides-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
