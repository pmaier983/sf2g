import type { RouteCategory } from '../lib/database.types'
import { ROUTE_LABELS } from '../lib/constants'

interface LeaderboardFiltersProps {
  searchFilter: string
  onSearchChange: (value: string) => void
  routeFilter: RouteCategory | 'all'
  onRouteFilterChange: (value: RouteCategory | 'all') => void
  pprFilter: boolean
  onPprFilterChange: (value: boolean) => void
  leaderboardMode: 'total' | 'speed'
  onModeChange: (mode: 'total' | 'speed') => void
}

/** Route options for the filter dropdown (excluding 'other' in speed mode). */
const ROUTE_OPTIONS: { value: RouteCategory; label: string }[] = [
  { value: 'bayway', label: ROUTE_LABELS.bayway },
  { value: 'skyline', label: ROUTE_LABELS.skyline },
  { value: 'hmbw', label: ROUTE_LABELS.hmbw },
  { value: 'royale', label: ROUTE_LABELS.royale },
]

/**
 * LeaderboardFilters — extracted filter bar for the leaderboard page.
 * Includes search, route dropdown, PPR toggle, and mode selector.
 */
export function LeaderboardFilters({
  searchFilter,
  onSearchChange,
  routeFilter,
  onRouteFilterChange,
  pprFilter,
  onPprFilterChange,
  leaderboardMode,
  onModeChange,
}: LeaderboardFiltersProps) {
  const handleRouteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as RouteCategory | 'all'
    onRouteFilterChange(value)
  }

  const handleModeChange = (mode: 'total' | 'speed') => {
    onModeChange(mode)
    // When switching to speed mode, force a specific route if 'all' is selected
    if (mode === 'speed' && routeFilter === 'all') {
      onRouteFilterChange('bayway')
    }
  }

  return (
    <div className="leaderboard__filters">
      <input
        id="leaderboard-search"
        name="leaderboard-search"
        className="leaderboard__search"
        type="text"
        placeholder="🔍 Search riders..."
        value={searchFilter}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <select
        id="leaderboard-route-filter"
        name="leaderboard-route-filter"
        className="leaderboard__filter-select"
        value={routeFilter}
        onChange={handleRouteChange}
      >
        {leaderboardMode === 'total' && (
          <option value="all">All Routes</option>
        )}
        {ROUTE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        className={`leaderboard__filter-toggle${pprFilter ? ' leaderboard__filter-toggle--active' : ''}`}
        type="button"
        onClick={() => onPprFilterChange(!pprFilter)}
      >
        🌅 6am @ PPR
      </button>
      <div className="leaderboard__mode-toggle">
        <button
          className={`leaderboard__mode-btn${leaderboardMode === 'total' ? ' leaderboard__mode-btn--active' : ''}`}
          type="button"
          onClick={() => handleModeChange('total')}
        >
          🏆 Total Rides
        </button>
        <button
          className={`leaderboard__mode-btn${leaderboardMode === 'speed' ? ' leaderboard__mode-btn--active' : ''}`}
          type="button"
          onClick={() => handleModeChange('speed')}
        >
          ⚡ Fastest by Route
        </button>
      </div>
    </div>
  )
}
