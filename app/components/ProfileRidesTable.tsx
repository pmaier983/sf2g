/**
 * ProfileRidesTable — sortable table of a user's SF2G rides.
 *
 * Features:
 * - Sortable columns (date, route, speed, distance, elevation, time)
 * - Route category tag
 * - Unit-aware formatting (mi/km)
 */
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Ride } from '../lib/database.types'
import { RouteTag } from './RouteTag'
import { useUnit } from '../lib/useUnit'
import { currentUserQueryOptions } from '../queries/user'
import { EditRideDialog } from './EditRideDialog'
import type { EditRideData } from './EditRideDialog'
import { Tooltip } from './Tooltip'
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatMovingTime,
  formatRideDate,
} from '../lib/leaderboard-utils'

interface ProfileRidesTableProps {
  rides: Ride[]
  profileUserId: string
}

type SortKey =
  | 'ride_date'
  | 'name'
  | 'route_category'
  | 'average_speed_mps'
  | 'distance_meters'
  | 'elevation_gain_meters'
  | 'moving_time_seconds'


const BASE_COLUMNS: {
  key: SortKey
  label: string
  className?: string
}[] = [
  { key: 'ride_date', label: 'Date' },
  { key: 'name', label: 'Ride Name', className: 'profile-rides__name-col' },
  { key: 'route_category', label: 'Route' },
  { key: 'average_speed_mps', label: 'Avg Speed' },
  { key: 'distance_meters', label: 'Distance' },
  { key: 'elevation_gain_meters', label: 'Elevation' },
  { key: 'moving_time_seconds', label: 'Time' },
]

export function ProfileRidesTable({ rides, profileUserId }: ProfileRidesTableProps) {
  const unit = useUnit()
  const { data: currentUser } = useQuery(currentUserQueryOptions())
  const [editingRide, setEditingRide] = useState<EditRideData | null>(null)
  const isOwnProfile = currentUser?.id === profileUserId
  const [sortKey, setSortKey] = useState<SortKey>('ride_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }


  const sorted = useMemo(() => {
    return [...rides].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]

      // Handle nulls
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      // String comparison for name/date/route
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const cmp = aVal.localeCompare(bVal)
        return sortDir === 'asc' ? cmp : -cmp
      }

      // Numeric comparison
      const numA = Number(aVal)
      const numB = Number(bVal)
      return sortDir === 'asc' ? numA - numB : numB - numA
    })
  }, [rides, sortKey, sortDir])



  return (
    <div className="profile-rides">
      {/* Ride count */}
      <div className="profile-rides__filter-row">
        <span className="profile-rides__count">
          {rides.length} SF2G ride{rides.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="profile-rides__table-wrapper">
        <table className="profile-rides__table">
          <thead>
            <tr>
              {BASE_COLUMNS.map((col) => {
                const isSorted = sortKey === col.key
                return (
                  <th
                    key={col.key}
                    className={col.className}
                    onClick={() => handleSort(col.key)}
                    style={{ cursor: 'pointer' }}
                    aria-sort={
                      isSorted
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {col.label}
                    {isSorted && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                )
              })}
              {isOwnProfile && <th className="profile-rides__edit-col" />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={BASE_COLUMNS.length + (isOwnProfile ? 1 : 0)} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-text-muted)' }}>
                  No rides found
                </td>
              </tr>
            ) : (
              sorted.map((ride) => (
                <tr key={ride.id}>
                  <td>{formatRideDate(ride.ride_date) ?? '—'}</td>
                  <td className="profile-rides__name-col" title={ride.name ?? undefined}>
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
                  <td>
                    {ride.route_category ? (
                      <RouteTag category={ride.route_category} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>{formatSpeed(ride.average_speed_mps, unit)}</td>
                  <td>{formatDistance(ride.distance_meters, unit)}</td>
                  <td>{formatElevation(ride.elevation_gain_meters, unit)}</td>
                  <td>{formatMovingTime(ride.moving_time_seconds)}</td>
                  {isOwnProfile && (
                    <td className="profile-rides__edit-col">
                      <Tooltip content="Edit this ride">
                        <button
                          className="edit-ride-btn"
                          onClick={() =>
                            setEditingRide({
                              id: ride.id,
                              name: ride.name,
                              rideDate: ride.ride_date,
                              routeCategory: ride.route_category,
                              stravaActivityId: ride.strava_activity_id,
                            })
                          }
                          aria-label="Edit ride"
                        >
                          ✏️
                        </button>
                      </Tooltip>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Ride Dialog */}
      {editingRide && (
        <EditRideDialog
          ride={editingRide}
          isOpen={!!editingRide}
          onClose={() => setEditingRide(null)}
        />
      )}
    </div>
  )
}
