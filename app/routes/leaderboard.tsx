import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useCallback, useState } from 'react'
import {
  leaderboardQueryOptions,
  filteredLeaderboardQueryOptions,
  pprDawnRiderIdsQueryOptions,
  riderGrowthQueryOptions,
  companyRiderIdsQueryOptions,
} from '../queries/leaderboard'
import { ridesLeaderboardQueryOptions } from '../queries/rides'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { RidesLeaderboardTable } from '../components/RidesLeaderboardTable'
import { GrowthChart } from '../components/GrowthChart'
import { FilterChips } from '../components/FilterChips'
import { SyncStatus } from '../components/SyncStatus'
import { RIDER_COLORS } from '../lib/constants'
import type { RouteCategory, DestinationCompany } from '../lib/database.types'
import '../styles/leaderboard.css'

// ---------------------------------------------------------------------------
// Route definition with query param validation
// ---------------------------------------------------------------------------

/** Search params for the /leaderboard route */
export interface LeaderboardSearch {
  routes: RouteCategory[]
  search: string
  ppr: boolean
  company: string | undefined
  user: string | undefined
  view: 'riders' | 'rides'
  sort: string
  dir: 'asc' | 'desc'
  rSort: string
  rDir: 'asc' | 'desc'
  page: number
  dateFrom: string | undefined
  dateTo: string | undefined
  datePreset: string | undefined
  density: 'condensed' | 'expanded'
}

export const Route = createFileRoute('/leaderboard')({
  validateSearch: (search: Record<string, unknown>): LeaderboardSearch => ({
    routes: typeof search.routes === 'string' && search.routes
      ? (search.routes.split(',').filter(Boolean) as RouteCategory[])
      : Array.isArray(search.routes)
        ? (search.routes as RouteCategory[])
        : [],
    search: (search.search as string) || '',
    ppr: search.ppr === 'true' || search.ppr === true,
    company: (search.company as string) || undefined,
    user: (search.user as string) || undefined,
    view: (search.view as 'riders' | 'rides') || 'riders',
    sort: (search.sort as string) || 'sf2g_total',
    dir: (search.dir as 'asc' | 'desc') || 'desc',
    rSort: (search.rSort as string) || 'ride_date',
    rDir: (search.rDir as 'asc' | 'desc') || 'desc',
    page: Number(search.page) || 1,
    dateFrom: (search.dateFrom as string) || undefined,
    dateTo: (search.dateTo as string) || undefined,
    datePreset: (search.datePreset as string) || undefined,
    density: (search.density as 'condensed' | 'expanded') || 'expanded',
  }),
  // Strip defaults to keep URLs clean
  search: {
    middlewares: [
      ({ search, next }) => {
        const cleaned = { ...search } as Record<string, unknown>
        // Convert routes array to comma string for URL
        if (Array.isArray(cleaned.routes)) {
          if ((cleaned.routes as string[]).length === 0) {
            delete cleaned.routes
          } else {
            cleaned.routes = (cleaned.routes as string[]).join(',')
          }
        }
        // Strip defaults
        if (!cleaned.search) delete cleaned.search
        if (!cleaned.ppr) delete cleaned.ppr
        if (!cleaned.company) delete cleaned.company
        if (!cleaned.user) delete cleaned.user
        if (cleaned.view === 'riders') delete cleaned.view
        if (cleaned.sort === 'sf2g_total') delete cleaned.sort
        if (cleaned.dir === 'desc') delete cleaned.dir
        if (cleaned.rSort === 'ride_date') delete cleaned.rSort
        if (cleaned.rDir === 'desc') delete cleaned.rDir
        if (cleaned.page === 1) delete cleaned.page
        if (!cleaned.dateFrom) delete cleaned.dateFrom
        if (!cleaned.dateTo) delete cleaned.dateTo
        if (!cleaned.datePreset) delete cleaned.datePreset
        if (cleaned.density === 'expanded') delete cleaned.density
        return next(cleaned as unknown as typeof search)
      },
    ],
  },
  component: LeaderboardPage,
  head: () => ({
    meta: [
      { title: 'Leaderboard — SF2G' },
      {
        name: 'description',
        content:
          'SF2G leaderboard — riders and rides ranked by commute counts, speed, and routes.',
      },
    ],
  }),
})

// ---------------------------------------------------------------------------
// Main Leaderboard Page component
// ---------------------------------------------------------------------------
function LeaderboardPage() {
  const {
    routes,
    search,
    ppr,
    company,
    user,
    view,
    sort,
    dir,
    rSort,
    rDir,
    page,
    dateFrom,
    dateTo,
    datePreset,
    density,
  } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  // ---- Chart local state ----
  const [chartOpen, setChartOpen] = useState(false)
  const [chartTimeRange, setChartTimeRange] = useState<'all' | '6m' | '1y' | '2y'>('all')
  const [visibleRiderIds, setVisibleRiderIds] = useState<string[]>([])

  // ---- Data queries ----
  // Determine if we need filtered (compound) leaderboard
  const hasCompoundFilters = routes.length > 0 || !!company || !!dateFrom || !!dateTo

  // Use filtered leaderboard when compound filters are active
  const leaderboardOptions = hasCompoundFilters
    ? filteredLeaderboardQueryOptions({
        sortBy: sort,
        sortDir: dir,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        routeCategories: routes.length > 0 ? routes : undefined,
        company: company || undefined,
      })
    : leaderboardQueryOptions({
        sortBy: sort,
        sortDir: dir,
      })
  const { data: leaderboardData, isLoading, error } = useQuery(leaderboardOptions)
  const { data: pprDawnRiderIds } = useQuery(pprDawnRiderIdsQueryOptions())
  const { data: companyRiderIds } = useQuery(companyRiderIdsQueryOptions(company))
  const { data: growthData } = useQuery(riderGrowthQueryOptions())

  const ridesQuery = useQuery(
    ridesLeaderboardQueryOptions({
      userId: user || undefined,
      routeCategories: routes.length > 0 ? routes : undefined,
      company: company || undefined,
      search: search || undefined,
      sortBy: rSort,
      sortDir: rDir,
      page,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
  )

  // ---- Client-side filtering for the Users table ----
  const filteredData = useMemo(() => {
    if (!leaderboardData) return []
    let data = leaderboardData

    // When using filtered leaderboard, route and company are already applied server-side
    // Only need client-side filtering for PPR and search
    if (!hasCompoundFilters) {
      // Route filter (only when NOT using filtered leaderboard)
      if (routes.length > 0) {
        data = data.filter((entry) => {
          return routes.some((r) => {
            const key = `${r}_count` as keyof typeof entry
            return (entry[key] as number) > 0
          })
        })
      }

      // Company filter (only when NOT using filtered leaderboard)
      if (company && companyRiderIds) {
        const companySet = new Set(companyRiderIds)
        data = data.filter((entry) => companySet.has(entry.user_id))
      }
    }

    // PPR filter (always client-side)
    if (ppr && pprDawnRiderIds) {
      const pprSet = new Set(pprDawnRiderIds)
      data = data.filter((entry) => pprSet.has(entry.user_id))
    }

    // Search filter (always client-side for riders table)
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(
        (entry) =>
          entry.display_name?.toLowerCase().includes(q) ||
          entry.username?.toLowerCase().includes(q),
      )
    }

    return data
  }, [leaderboardData, routes, ppr, pprDawnRiderIds, company, companyRiderIds, search, hasCompoundFilters])

  // ---- Top 10 visible riders → colors ----
  const top10Visible = useMemo(() => visibleRiderIds.slice(0, 10), [visibleRiderIds])

  const riderColorMap = useMemo(() => {
    const map = new Map<string, string>()
    top10Visible.forEach((id, i) => {
      map.set(id, RIDER_COLORS[i % RIDER_COLORS.length])
    })
    return map
  }, [top10Visible])

  const riderNameMap = useMemo(() => {
    const map = new Map<string, string>()
    if (leaderboardData) {
      for (const entry of leaderboardData) {
        map.set(entry.user_id, entry.display_name ?? entry.username ?? 'Rider')
      }
    }
    return map
  }, [leaderboardData])

  // ---- Visible rider tracking ----
  const handleVisibleRidersChange = useCallback((ids: string[]) => {
    setVisibleRiderIds(ids)
  }, [])

  // ---- View toggle handler ----
  const handleViewChange = useCallback(
    (newView: 'riders' | 'rides') => {
      navigate({
        search: (prev) => ({
          ...prev,
          view: newView,
          page: 1,
        }),
      })
    },
    [navigate],
  )

  // ---- Navigate handler for "View rides" from the users table ----
  const handleViewRides = useCallback(
    (userId: string, routeCategory?: RouteCategory) => {
      navigate({
        search: (prev) => ({
          ...prev,
          view: 'rides' as const,
          user: userId,
          routes: routeCategory ? [routeCategory] : prev.routes,
          page: 1,
        }),
      })
    },
    [navigate],
  )

  // ---- Search param update helpers ----
  const handleSearchChange = useCallback(
    (value: string) => {
      navigate({ search: (prev) => ({ ...prev, search: value, page: 1 }) })
    },
    [navigate],
  )

  const handleRoutesChange = useCallback(
    (newRoutes: RouteCategory[]) => {
      navigate({
        search: (prev) => ({
          ...prev,
          routes: newRoutes,
          page: 1,
        }),
      })
    },
    [navigate],
  )

  const handlePprChange = useCallback(
    (active: boolean) => {
      navigate({ search: (prev) => ({ ...prev, ppr: active }) })
    },
    [navigate],
  )

  const handleCompanyChange = useCallback(
    (newCompany: DestinationCompany | undefined) => {
      navigate({ search: (prev) => ({ ...prev, company: newCompany, page: 1 }) })
    },
    [navigate],
  )

  const handleDateChange = useCallback(
    (newDateFrom: string | undefined, newDateTo: string | undefined, preset: string | undefined) => {
      navigate({
        search: (prev) => ({
          ...prev,
          dateFrom: newDateFrom,
          dateTo: newDateTo,
          datePreset: preset,
          page: 1,
        }),
      })
    },
    [navigate],
  )

  const handleSortChange = useCallback(
    (column: string, direction: 'asc' | 'desc') => {
      navigate({ search: (prev) => ({ ...prev, sort: column, dir: direction }) })
    },
    [navigate],
  )

  const handleRidesSortChange = useCallback(
    (column: string, direction: 'asc' | 'desc') => {
      navigate({ search: (prev) => ({ ...prev, rSort: column, rDir: direction, page: 1 }) })
    },
    [navigate],
  )

  const handlePageChange = useCallback(
    (newPage: number) => {
      navigate({ search: (prev) => ({ ...prev, page: newPage }) })
    },
    [navigate],
  )

  const handleClearUser = useCallback(() => {
    navigate({ search: (prev) => ({ ...prev, user: undefined, page: 1 }) })
  }, [navigate])

  const handleDensityChange = useCallback(
    (newDensity: 'condensed' | 'expanded') => {
      navigate({ search: (prev) => ({ ...prev, density: newDensity }) })
    },
    [navigate],
  )

  return (
    <section className={`leaderboard${chartOpen ? ' leaderboard--chart-open' : ''}`}>
      {/* Toolbar: View toggle | Chart btn | Search | Density | Sync — all on one line */}
      <div className="leaderboard__toolbar">
        <div className="leaderboard__view-toggle">
          <button
            className={`leaderboard__view-btn ${view === 'riders' ? 'leaderboard__view-btn--active' : ''}`}
            onClick={() => handleViewChange('riders')}
            aria-pressed={view === 'riders'}
          >
            Riders
          </button>
          <button
            className={`leaderboard__view-btn ${view === 'rides' ? 'leaderboard__view-btn--active' : ''}`}
            onClick={() => handleViewChange('rides')}
            aria-pressed={view === 'rides'}
          >
            Rides
          </button>
        </div>
        <button
          className={`leaderboard__chart-btn${chartOpen ? ' leaderboard__chart-btn--active' : ''}`}
          onClick={() => setChartOpen(!chartOpen)}
          aria-pressed={chartOpen}
          aria-label={chartOpen ? 'Hide growth chart' : 'Show growth chart'}
          title="Toggle growth chart"
        >
          📊
        </button>
        <label htmlFor="leaderboard-search" className="sr-only">
          {view === 'riders' ? 'Search riders' : 'Search rides'}
        </label>
        <input
          id="leaderboard-search"
          type="search"
          className="leaderboard__search"
          placeholder={view === 'riders' ? 'Search riders...' : 'Search rides...'}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {/* Density toggle — only show in riders view */}
        {view === 'riders' && (
          <div className="leaderboard__density-toggle">
            <button
              className={`leaderboard__density-btn${density === 'condensed' ? ' leaderboard__density-btn--active' : ''}`}
              onClick={() => handleDensityChange('condensed')}
              aria-pressed={density === 'condensed'}
              title="Condensed view"
            >
              ≡
            </button>
            <button
              className={`leaderboard__density-btn${density === 'expanded' ? ' leaderboard__density-btn--active' : ''}`}
              onClick={() => handleDensityChange('expanded')}
              aria-pressed={density === 'expanded'}
              title="Expanded view"
            >
              ⊞
            </button>
          </div>
        )}
        <SyncStatus />
      </div>

      {/* Filters below toolbar */}
      <div className="leaderboard__filters-bar">
        <FilterChips
          selectedRoutes={routes}
          onRoutesChange={handleRoutesChange}
          pprActive={ppr}
          onPprChange={handlePprChange}
          selectedCompany={company as DestinationCompany | undefined}
          onCompanyChange={handleCompanyChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          datePreset={datePreset}
          onDateChange={handleDateChange}
        />
      </div>

      {/* Main layout: chart panel (left) + table (right), BELOW filters */}
      <div className="leaderboard__layout">
        {/* Side panel for Growth Chart — LEFT of table */}
        {chartOpen && (
          <aside className="leaderboard__chart-panel">
            {growthData && growthData.length > 0 ? (
              <GrowthChart
                growthData={growthData}
                visibleRiderIds={top10Visible}
                riderColorMap={riderColorMap}
                riderNameMap={riderNameMap}
                timeRange={chartTimeRange}
                onTimeRangeChange={setChartTimeRange}
              />
            ) : (
              <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
                <div className="empty-state__icon">📈</div>
                <h3 className="empty-state__title">No growth data yet</h3>
                <p className="empty-state__description">
                  Ride data will appear here once riders have synced their Strava history.
                </p>
              </div>
            )}
          </aside>
        )}

        {/* Table fills remaining space */}
        <div className="leaderboard__table-area">
          {view === 'riders' ? (
            <>
              {error ? (
                <div className="error-state">
                  <div className="error-state__icon">⚠️</div>
                  <h3 className="error-state__title">Failed to load leaderboard</h3>
                  <p className="error-state__message">{error.message}</p>
                </div>
              ) : isLoading ? (
                <div className="loading-state">
                  <div className="loading-state__spinner" />
                  <p className="loading-state__text">Loading leaderboard...</p>
                </div>
              ) : (
                <LeaderboardTable
                  data={filteredData}
                  searchFilter={search}
                  riderColorMap={riderColorMap}
                  onViewRides={handleViewRides}
                  onVisibleRidersChange={handleVisibleRidersChange}
                  sortBy={sort}
                  sortDir={dir}
                  onSortChange={handleSortChange}
                  density={density}
                />
              )}
            </>
          ) : (
            <RidesLeaderboardTable
              data={ridesQuery.data}
              isLoading={ridesQuery.isLoading}
              sortBy={rSort}
              sortDir={rDir}
              onSortChange={handleRidesSortChange}
              onPageChange={handlePageChange}
              activeUser={user}
              onClearUser={handleClearUser}
            />
          )}
        </div>
      </div>
    </section>
  )
}
