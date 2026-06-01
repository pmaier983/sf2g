import { useRef, useEffect, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LeaderboardEntry, RouteCategory } from '../lib/database.types'
import { getLeaderboardColumns, type TableDensity } from './LeaderboardColumns'
import { useUnit } from '../lib/useUnit'

interface LeaderboardTableProps {
  data: LeaderboardEntry[]
  searchFilter: string
  riderColorMap: Map<string, string>
  onViewRides: (userId: string, routeCategory?: RouteCategory) => void
  onVisibleRidersChange: (riderIds: string[]) => void
  sortBy: string
  sortDir: 'asc' | 'desc'
  onSortChange: (column: string, direction: 'asc' | 'desc') => void
  density: TableDensity
}

/**
 * LeaderboardTable — virtualized table using TanStack Table + TanStack Virtual.
 * Renders only visible rows for performance.
 * Sorting is server-side — this component does NOT re-sort data locally.
 */
export function LeaderboardTable({
  data,
  searchFilter,
  riderColorMap,
  onViewRides,
  onVisibleRidersChange,
  sortBy,
  sortDir,
  onSortChange,
  density,
}: LeaderboardTableProps) {
  const unit = useUnit()
  const columns = useMemo(
    () => getLeaderboardColumns(unit, density),
    [unit, density],
  )
  // Derive sorting state from props (visual indicator only)
  const sorting: SortingState = [{ id: sortBy, desc: sortDir === 'desc' }]

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: searchFilter,
    },
    onSortingChange: (updater) => {
      // Intercept sort changes and delegate to parent via onSortChange
      const newSorting = typeof updater === 'function' ? updater(sorting) : updater
      if (newSorting.length > 0) {
        const col = newSorting[0]
        onSortChange(col.id, col.desc ? 'desc' : 'asc')
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // No getSortedRowModel — data comes pre-sorted from server
    manualSorting: true,
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const name = row.original.display_name ?? row.original.username ?? ''
      return name.toLowerCase().includes(filterValue.toLowerCase())
    },
    meta: {
      onViewRides,
    },
  })

  const { rows } = table.getRowModel()

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  })

  // Track visible riders and report changes
  const prevFirstVisibleRef = useRef(-1)
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (virtualItems.length === 0) return
    const firstIdx = virtualItems[0].index
    if (firstIdx === prevFirstVisibleRef.current) return
    prevFirstVisibleRef.current = firstIdx
    const visibleIds = virtualItems
      .map((item) => rows[item.index]?.original.user_id)
      .filter(Boolean)
    onVisibleRidersChange(visibleIds)
  }, [virtualItems, rows, onVisibleRidersChange])

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🔍</div>
        <h3 className="empty-state__title">No riders found</h3>
        <p className="empty-state__description">
          {searchFilter
            ? 'Try a different search term.'
            : 'No riders have synced their data yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="leaderboard__table-wrapper" aria-label="Riders leaderboard">
      <div
        ref={parentRef}
        style={{ flex: 1, overflow: 'auto' }}
      >
        <table className="leaderboard__table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={
                        sorted ? 'leaderboard__table th--sorted' : ''
                      }
                      style={{
                        width: header.getSize(),
                        cursor: canSort ? 'pointer' : 'default',
                      }}
                      aria-sort={
                        canSort
                          ? sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sorted && (
                        <span className="sort-indicator">
                          {sorted === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualItems.length > 0 && (
              <>
                {virtualItems.map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  const color = riderColorMap.get(row.original.user_id)
                  return (
                    <tr
                      key={row.id}
                      style={{
                        height: `${virtualRow.size}px`,
                        borderLeft: color
                          ? `3px solid ${color}`
                          : undefined,
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
