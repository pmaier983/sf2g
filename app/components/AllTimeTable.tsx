import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { AllTimeEntry } from '../server/alltime'
import { formatRideDate } from '../lib/leaderboard-utils'
import { Tooltip } from './Tooltip'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface AllTimeTableProps {
  data: AllTimeEntry[] | undefined
  isLoading: boolean
  searchFilter: string
  durationLabel: string
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
interface ColumnDef {
  key: string
  label: string
  sortable: boolean
  tooltip: string
  className?: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', sortable: false, tooltip: 'Rank by max rides in window', className: 'alltime-table__rank' },
  { key: 'rider', label: 'Rider', sortable: false, tooltip: 'Rider name — click to view their profile' },
  { key: 'maxRidesInWindow', label: 'Max Rides', sortable: true, tooltip: 'Maximum number of SF2G rides completed within the rolling window' },
  { key: 'windowStart', label: 'Window Start', sortable: true, tooltip: 'Start date of the best rolling window' },
  { key: 'windowEnd', label: 'Window End', sortable: true, tooltip: 'End date of the best rolling window' },
  { key: 'totalSf2gRides', label: 'Total Rides', sortable: true, tooltip: 'Total SF2G rides by this rider (all time)' },
]

const SKELETON_ROWS = 8

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AllTimeTable({
  data,
  isLoading,
  searchFilter,
  durationLabel,
}: AllTimeTableProps) {
  const [sortKey, setSortKey] = useState('maxRidesInWindow')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Client-side search filtering
  const filteredData = useMemo(() => {
    if (!data) return []
    if (!searchFilter) return data
    const q = searchFilter.toLowerCase()
    return data.filter(entry => entry.displayName.toLowerCase().includes(q))
  }, [data, searchFilter])

  // Client-side sorting
  const sortedData = useMemo(() => {
    const sorted = [...filteredData]
    sorted.sort((a, b) => {
      const aVal = a[sortKey as keyof AllTimeEntry] ?? 0
      const bVal = b[sortKey as keyof AllTimeEntry] ?? 0
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [filteredData, sortKey, sortDir])

  const handleSort = (col: ColumnDef) => {
    if (!col.sortable) return
    if (sortKey === col.key) {
      setSortDir(prev => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(col.key)
      setSortDir('desc')
    }
  }

  const ariaSortValue = (col: ColumnDef): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== col.key) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  return (
    <div className="alltime-table">
      <div className="alltime-table__header">
        <span className="alltime-table__title">
          🏆 Best {durationLabel} — Max Rides in Rolling Window
        </span>
        <span className="alltime-table__count">
          {filteredData.length} rider{filteredData.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="alltime-table__wrapper">
        <table role="grid" aria-label="All-time rolling window leaderboard">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <Tooltip key={col.key} content={col.tooltip}>
                  <th
                    className={col.className}
                    aria-sort={col.sortable ? ariaSortValue(col) : undefined}
                    onClick={() => handleSort(col)}
                    style={col.sortable ? { cursor: 'pointer' } : { cursor: 'help' }}
                  >
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span className="sort-indicator">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </th>
                </Tooltip>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="alltime-table__empty">
                  No riders match the current filters
                </td>
              </tr>
            ) : (
              sortedData.map((entry, idx) => (
                <AllTimeRow key={entry.userId} entry={entry} rank={idx + 1} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------
function AllTimeRow({ entry, rank }: { entry: AllTimeEntry; rank: number }) {
  return (
    <tr>
      {/* Rank */}
      <td className="alltime-table__rank">{rank}</td>

      {/* Rider */}
      <td>
        <div className="alltime-table__rider">
          {entry.avatarUrl ? (
            <img
              className="alltime-table__avatar"
              src={entry.avatarUrl}
              alt=""
              loading="lazy"
              width={32}
              height={32}
            />
          ) : (
            <span className="alltime-table__avatar-fallback" aria-hidden="true">
              👤
            </span>
          )}
          <Link
            to="/profile/$userId"
            params={{ userId: entry.userId }}
            className="alltime-table__rider-name"
          >
            {entry.displayName}
          </Link>
        </div>
      </td>

      {/* Max Rides */}
      <td className="alltime-table__max-rides">
        <strong>{entry.maxRidesInWindow}</strong>
      </td>

      {/* Window Start */}
      <td>{formatRideDate(entry.windowStart) ?? '—'}</td>

      {/* Window End */}
      <td>{formatRideDate(entry.windowEnd) ?? '—'}</td>

      {/* Total Rides */}
      <td className="alltime-table__total">{entry.totalSf2gRides}</td>
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
        <tr key={`skel-${i}`} className="alltime-table__skeleton-row">
          {COLUMNS.map(col => (
            <td key={col.key}>
              <div className="alltime-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
