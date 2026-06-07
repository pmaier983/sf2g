import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useCallback, useState, useEffect } from 'react'
import { MobileBottomBar } from '../components/MobileBottomBar'
import { MobileSettingsPanel } from '../components/MobileSettingsPanel'
import {
  leaderboardQueryOptions,
  filteredLeaderboardQueryOptions,
  pprDawnRiderIdsQueryOptions,
  riderGrowthQueryOptions,
  dailyGrowthQueryOptions,
  companyRiderIdsQueryOptions,
} from '../queries/leaderboard'
import { ridesLeaderboardQueryOptions } from '../queries/rides'
import { allTimeQueryOptions } from '../queries/alltime'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { RidesLeaderboardTable } from '../components/RidesLeaderboardTable'
import { AllTimeTable } from '../components/AllTimeTable'
import { GrowthChart } from '../components/GrowthChart'
import { AllTimeChart } from '../components/AllTimeChart'
import { FilterChips } from '../components/FilterChips'
import { SyncStatus } from '../components/SyncStatus'
import { RIDER_COLORS } from '../lib/constants'
import type { RouteCategory, DestinationCompany } from '../lib/database.types'
import '../styles/leaderboard.css'

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

/** Parse a duration string like '1w', '1m', '1y', '14d' to days */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dwmy])$/i)
  if (!match) return 7 // fallback to 1 week
  const num = parseInt(match[1], 10)
  switch (match[2].toLowerCase()) {
    case 'd': return num
    case 'w': return num * 7
    case 'm': return num * 30
    case 'y': return num * 365
    default: return 7
  }
}

/** Convert a duration string to a human-readable label */
function getDurationLabel(duration: string): string {
  const match = duration.match(/^(\d+)([dwmy])$/i)
  if (!match) return '1 Week'
  const num = parseInt(match[1], 10)
  switch (match[2].toLowerCase()) {
    case 'd': return `${num} Day${num !== 1 ? 's' : ''}`
    case 'w': return `${num} Week${num !== 1 ? 's' : ''}`
    case 'm': return `${num} Month${num !== 1 ? 's' : ''}`
    case 'y': return `${num} Year${num !== 1 ? 's' : ''}`
    default: return duration
  }
}

// ---------------------------------------------------------------------------
// Route definition with query param validation
// ---------------------------------------------------------------------------

/** Search params for the /leaderboard route */
export interface LeaderboardSearch {
  routes: RouteCategory[]
  search: string
  ppr: boolean
  other: boolean
  weekends: boolean
  company: string | undefined
  user: string | undefined
  view: 'riders' | 'rides' | 'alltime'
  duration: string
  chart: boolean
  sort: string
  dir: 'asc' | 'desc'
  rSort: string
  rDir: 'asc' | 'desc'
  page: number
  dateFrom: string | undefined
  dateTo: string | undefined
  datePreset: string | undefined
  density: 'condensed' | 'expanded'
  reverse: boolean
}

/** Default search param values — used for validation and URL cleanup */
const SEARCH_DEFAULTS: LeaderboardSearch = {
  routes: [],
  search: '',
  ppr: false,
  other: false,
  weekends: true,
  company: undefined,
  user: undefined,
  view: 'riders',
  duration: '1y',
  chart: false,
  sort: 'sf2g_total',
  dir: 'desc',
  rSort: 'ride_date',
  rDir: 'desc',
  page: 1,
  dateFrom: undefined,
  dateTo: undefined,
  datePreset: undefined,
  density: 'condensed',
  reverse: false,
}

const toBool = (v: unknown) => v === 'true' || v === true

export const Route = createFileRoute('/leaderboard')({
  validateSearch: (raw: Record<string, unknown>): LeaderboardSearch => ({
    routes: typeof raw.routes === 'string' && raw.routes
      ? (raw.routes.split(',').filter(Boolean) as RouteCategory[])
      : Array.isArray(raw.routes) ? (raw.routes as RouteCategory[]) : [],
    search: (raw.search as string) || '',
    ppr: toBool(raw.ppr),
    other: toBool(raw.other),
    weekends: raw.weekends === undefined ? true : toBool(raw.weekends),
    company: (raw.company as string) || undefined,
    user: (raw.user as string) || undefined,
    view: (raw.view as 'riders' | 'rides' | 'alltime') || 'riders',
    duration: (raw.duration as string) || '1y',
    chart: toBool(raw.chart),
    sort: (raw.sort as string) || 'sf2g_total',
    dir: (raw.dir as 'asc' | 'desc') || 'desc',
    rSort: (raw.rSort as string) || 'ride_date',
    rDir: (raw.rDir as 'asc' | 'desc') || 'desc',
    page: Number(raw.page) || 1,
    dateFrom: (raw.dateFrom as string) || undefined,
    dateTo: (raw.dateTo as string) || undefined,
    datePreset: (raw.datePreset as string) || undefined,
    density: (raw.density as 'condensed' | 'expanded') || 'condensed',
    reverse: toBool(raw.reverse),
  }),
  // Strip defaults to keep URLs clean
  search: {
    middlewares: [
      ({ search, next }) => {
        const out = { ...search } as Record<string, unknown>
        // Serialize routes array → comma string
        if (Array.isArray(out.routes)) {
          const arr = out.routes as string[]
          out.routes = arr.length > 0 ? arr.join(',') : undefined
        }
        // Remove values that match defaults — strict comparison handles
        // false, 0, '' correctly so they get stripped when they ARE the default.
        for (const [key, def] of Object.entries(SEARCH_DEFAULTS)) {
          if (key === 'routes') continue // handled above
          const val = out[key]
          // Both undefined/null/'' → treat as equal
          const valEmpty = val === undefined || val === null || val === ''
          const defEmpty = def === undefined || def === null || def === ''
          if (val === def || (valEmpty && defEmpty)) {
            delete out[key]
          }
        }
        return next(out as unknown as typeof search)
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
    routes, search, ppr, other: includeOther, weekends, company, user,
    view, chart: chartOpen, sort, dir, rSort, rDir, page,
    dateFrom, dateTo, datePreset, density, duration, reverse,
  } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  // ---- Shared search param updater ----
  const updateSearch = useCallback(
    (patch: Partial<LeaderboardSearch>) =>
      navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate],
  )

  // ---- Check if any filters differ from defaults ----
  const hasActiveFilters = useMemo(() => {
    if (routes.length > 0) return true
    if (search !== '') return true
    if (ppr) return true
    if (includeOther) return true
    if (!weekends) return true
    if (company) return true
    if (user) return true
    if (dateFrom) return true
    if (dateTo) return true
    if (datePreset) return true
    if (view !== 'riders') return true
    if (chartOpen) return true
    if (density !== 'condensed') return true
    if (sort !== 'sf2g_total') return true
    if (dir !== 'desc') return true
    if (rSort !== 'ride_date') return true
    if (rDir !== 'desc') return true
    if (page !== 1) return true
    if (duration !== '1y') return true
    if (reverse) return true
    return false
  }, [routes, search, ppr, includeOther, weekends, company, user, dateFrom, dateTo, datePreset, view, chartOpen, density, sort, dir, rSort, rDir, page, duration, reverse])

  // ---- Clear all filters → reset to defaults ----
  const handleClearAll = useCallback(
    () => navigate({ search: SEARCH_DEFAULTS }),
    [navigate],
  )

  // ---- Chart selection state (local — not URL-worthy) ----
  const [selectedRiderIds, setSelectedRiderIds] = useState<Set<string>>(new Set())
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false)

  // ---- Mobile state ----
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [mobileGraphOpen, setMobileGraphOpen] = useState(false)

  // ---- Data queries ----
  // Weekend exclusion (default) forces the compound filter path so we use
  // the parameterized RPC instead of the materialized view.
  const excludeWeekends = !weekends
  const hasCompoundFilters = routes.length > 0 || !!company || !!dateFrom || !!dateTo || excludeWeekends || !!reverse

  const leaderboardOptions = hasCompoundFilters
    ? filteredLeaderboardQueryOptions({
        sortBy: sort,
        sortDir: dir,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        routeCategories: routes.length > 0 ? routes : undefined,
        company: company || undefined,
        excludeWeekends,
        reverse: reverse || undefined,
      })
    : leaderboardQueryOptions({ sortBy: sort, sortDir: dir })
  const { data: leaderboardData, isLoading, error } = useQuery(leaderboardOptions)
  const { data: pprDawnData } = useQuery(pprDawnRiderIdsQueryOptions({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }))
  const pprDawnRiderIds = pprDawnData?.riderIds
  const pprRideCounts = pprDawnData?.rideCounts
  const pprRideIds = pprDawnData?.rideIds
  const { data: companyRiderIds } = useQuery(companyRiderIdsQueryOptions(company))
  const { data: growthData } = useQuery(riderGrowthQueryOptions())
  const { data: dailyData } = useQuery(dailyGrowthQueryOptions())

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
      includeOther,
      excludeWeekends,
      // When PPR filter is active, only show qualifying PPR rides
      pprRideIds: ppr ? pprRideIds : undefined,
      reverse: reverse || undefined,
    }),
  )

  // ---- All-Time query ----
  const durationDays = parseDuration(duration)
  const allTimeQuery = useQuery(
    allTimeQueryOptions({
      durationDays,
      routes: routes.length > 0 ? routes : undefined,
      excludeWeekends: !weekends,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      includeOther,
      company: company || undefined,
      reverse: reverse || undefined,
    }),
  )

  // ---- Client-side filtering for the Users table ----
  const filteredData = useMemo(() => {
    if (!leaderboardData) return []
    let data = leaderboardData
    // Track whether we've mutated values that require a client-side re-sort
    let needsResort = false

    if (!hasCompoundFilters) {
      if (routes.length > 0) {
        data = data.filter((entry) =>
          routes.some((r) => (entry[`${r}_count` as keyof typeof entry] as number) > 0),
        )
      }
      if (company && companyRiderIds) {
        const companySet = new Set(companyRiderIds)
        data = data.filter((entry) => companySet.has(entry.user_id))
      }
    }

    if (ppr && pprDawnRiderIds) {
      const pprSet = new Set(pprDawnRiderIds)
      data = data.filter((entry) => pprSet.has(entry.user_id))
      // Override sf2g_total with PPR ride count so the count column reflects
      // only PPR-qualifying rides when the PPR filter is active
      if (pprRideCounts) {
        data = data.map((entry) => ({
          ...entry,
          sf2g_total: pprRideCounts[entry.user_id] ?? 0,
        }))
        needsResort = true
      }
    }

    if (search) {
      const q = search.toLowerCase()
      data = data.filter(
        (entry) =>
          entry.display_name?.toLowerCase().includes(q) ||
          entry.username?.toLowerCase().includes(q),
      )
    }

    // Re-sort client-side when values have been mutated (e.g. PPR count override)
    // so the displayed order reflects the current sort column and direction.
    if (needsResort && sort) {
      const multiplier = dir === 'asc' ? 1 : -1
      data = [...data].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sort]
        const bVal = (b as Record<string, unknown>)[sort]
        const aNum = typeof aVal === 'number' ? aVal : 0
        const bNum = typeof bVal === 'number' ? bVal : 0
        return (aNum - bNum) * multiplier
      })
    }

    // Exclude riders with zero matching rides
    data = data.filter((entry) => {
      const total = includeOther || routes.includes('other' as RouteCategory)
        ? (entry.sf2g_total ?? 0) + (entry.other_count ?? 0)
        : (entry.sf2g_total ?? 0)
      return total > 0
    })

    return data
  }, [leaderboardData, routes, includeOther, ppr, pprDawnRiderIds, pprRideCounts, company, companyRiderIds, search, hasCompoundFilters, sort, dir])

  // ---- Default selection: top 10 by sf2g_total ----
  useEffect(() => {
    if (hasInitializedSelection || !leaderboardData || leaderboardData.length === 0) return
    const top10 = [...leaderboardData]
      .sort((a, b) => (b.sf2g_total ?? 0) - (a.sf2g_total ?? 0))
      .slice(0, 10)
      .map((e) => e.user_id)
    setSelectedRiderIds(new Set(top10))
    setHasInitializedSelection(true)
  }, [leaderboardData, hasInitializedSelection])

  // ---- Selected riders → ordered array + colors + names ----
  const selectedRiderArray = useMemo(() => {
    if (!leaderboardData) return []
    return leaderboardData.filter((e) => selectedRiderIds.has(e.user_id)).map((e) => e.user_id)
  }, [leaderboardData, selectedRiderIds])

  const riderColorMap = useMemo(() => {
    const map = new Map<string, string>()
    selectedRiderArray.forEach((id, i) => map.set(id, RIDER_COLORS[i % RIDER_COLORS.length]))
    return map
  }, [selectedRiderArray])

  const riderNameMap = useMemo(() => {
    const map = new Map<string, string>()
    if (leaderboardData) {
      for (const entry of leaderboardData) {
        map.set(entry.user_id, entry.display_name ?? entry.username ?? 'Rider')
      }
    }
    return map
  }, [leaderboardData])

  // ---- All Time rider maps (for chart) ----
  const allTimeRiderNameMap = useMemo(() => {
    const map = new Map<string, string>()
    if (allTimeQuery.data) {
      for (const entry of allTimeQuery.data) {
        map.set(entry.userId, entry.displayName ?? 'Rider')
      }
    }
    return map
  }, [allTimeQuery.data])

  const allTimeSelectedIds = useMemo(() => {
    if (!allTimeQuery.data) return new Set<string>()
    return new Set(allTimeQuery.data.slice(0, 10).map((e) => e.userId))
  }, [allTimeQuery.data])

  const allTimeRiderColorMap = useMemo(() => {
    const map = new Map<string, string>()
    const ids = allTimeQuery.data?.slice(0, 10) ?? []
    ids.forEach((e, i) => map.set(e.userId, RIDER_COLORS[i % RIDER_COLORS.length]))
    return map
  }, [allTimeQuery.data])

  // ---- Rider selection handlers ----
  const handleToggleRider = useCallback((userId: string) => {
    setSelectedRiderIds((prev) => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }, [])

  const handleSelectAllRiders = useCallback(() => {
    if (!filteredData) return
    setSelectedRiderIds(new Set(filteredData.slice(0, 10).map((e) => e.user_id)))
  }, [filteredData])

  const handleDeselectAllRiders = useCallback(() => setSelectedRiderIds(new Set()), [])

  const handleVisibleRidersChange = useCallback(() => {}, [])

  // ---- Navigate handler for "View rides" from the users table ----
  const handleViewRides = useCallback(
    (userId: string, routeCategory?: RouteCategory) =>
      updateSearch({
        view: 'rides',
        user: userId,
        ...(routeCategory ? { routes: [routeCategory] } : {}),
        page: 1,
      }),
    [updateSearch],
  )

  return (
    <section className={`leaderboard${chartOpen ? ' leaderboard--chart-open' : ''}`}>
      {/* ---- Mobile: Header with view toggle ---- */}
      <div className="mobile-view-header">
        <div className="mobile-view-header__toggle">
          <button
            type="button"
            className={`mobile-view-header__btn${view === 'riders' ? ' mobile-view-header__btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'riders', page: 1 })}
            aria-pressed={view === 'riders'}
          >
            👤 Riders
          </button>
          <button
            type="button"
            className={`mobile-view-header__btn${view === 'alltime' ? ' mobile-view-header__btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'alltime', page: 1 })}
            aria-pressed={view === 'alltime'}
          >
            🏆 All Time
          </button>
          <button
            type="button"
            className={`mobile-view-header__btn${view === 'rides' ? ' mobile-view-header__btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'rides', page: 1 })}
            aria-pressed={view === 'rides'}
          >
            🚴 Rides
          </button>
        </div>
      </div>

      {/* Toolbar: View toggle | Chart btn | Search | Density | Sync — all on one line */}
      <div className="leaderboard__toolbar">
        <div className="leaderboard__view-toggle">
          <button
            className={`leaderboard__view-btn ${view === 'riders' ? 'leaderboard__view-btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'riders', page: 1 })}
            aria-pressed={view === 'riders'}
          >
            👤 Riders
          </button>
          <button
            className={`leaderboard__view-btn ${view === 'alltime' ? 'leaderboard__view-btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'alltime', page: 1 })}
            aria-pressed={view === 'alltime'}
          >
            🏆 All Time
          </button>
          <button
            className={`leaderboard__view-btn ${view === 'rides' ? 'leaderboard__view-btn--active' : ''}`}
            onClick={() => updateSearch({ view: 'rides', page: 1 })}
            aria-pressed={view === 'rides'}
          >
            🚴 Rides
          </button>
        </div>
        <button
          className={`leaderboard__chart-btn${chartOpen ? ' leaderboard__chart-btn--active' : ''}`}
          onClick={() => updateSearch({ chart: !chartOpen })}
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
          placeholder={view === 'alltime' ? 'Search riders...' : view === 'riders' ? 'Search riders...' : 'Search rides...'}
          value={search}
          onChange={(e) => updateSearch({ search: e.target.value, page: 1 })}
        />
        <button
          type="button"
          className="filter-chips__clear-btn"
          onClick={handleClearAll}
          disabled={!hasActiveFilters}
          aria-label="Clear all filters"
        >
          <span className="filter-chips__clear-icon" aria-hidden="true">✕</span>
          Clear Filters
        </button>
        {/* Density toggle — only show in riders view */}
        {view === 'riders' && (
          <div className="leaderboard__density-toggle">
            <button
              className={`leaderboard__density-btn${density === 'condensed' ? ' leaderboard__density-btn--active' : ''}`}
              onClick={() => updateSearch({ density: 'condensed' })}
              aria-pressed={density === 'condensed'}
              title="Condensed view"
            >
              ≡
            </button>
            <button
              className={`leaderboard__density-btn${density === 'expanded' ? ' leaderboard__density-btn--active' : ''}`}
              onClick={() => updateSearch({ density: 'expanded' })}
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
          onRoutesChange={(r) => updateSearch({ routes: r, page: 1 })}
          pprActive={ppr}
          onPprChange={(v) => updateSearch({ ppr: v })}
          weekendsActive={weekends}
          onWeekendsChange={(v) => updateSearch({ weekends: v })}
          includeOther={includeOther}
          onOtherChange={(v) => updateSearch({ other: v })}
          selectedCompany={company as DestinationCompany | undefined}
          onCompanyChange={(c) => updateSearch({ company: c, page: 1 })}
          dateFrom={dateFrom}
          dateTo={dateTo}
          datePreset={datePreset}
          onDateChange={(from, to, preset) => updateSearch({ dateFrom: from, dateTo: to, datePreset: preset, page: 1 })}
          view={view}
          duration={duration}
          onDurationChange={(d) => updateSearch({ duration: d })}
          reverseActive={reverse}
          onReverseChange={(v) => updateSearch({ reverse: v })}
          hasActiveFilters={hasActiveFilters}
          onClearAll={handleClearAll}
        />
      </div>

      {/* Main layout: chart panel (left) + table (right), BELOW filters */}
      <div className="leaderboard__layout">
        {/* Side panel for Growth Chart — LEFT of table */}
        {chartOpen && (
          <aside className="leaderboard__chart-panel">
            {view === 'alltime' ? (
              <AllTimeChart
                data={allTimeQuery.data ?? []}
                durationDays={durationDays}
                durationLabel={getDurationLabel(duration)}
                riderColorMap={allTimeRiderColorMap}
                riderNameMap={allTimeRiderNameMap}
                selectedRiderIds={allTimeSelectedIds}
              />
            ) : growthData && growthData.length > 0 ? (
              <GrowthChart
                growthData={growthData}
                dailyData={dailyData}
                visibleRiderIds={selectedRiderArray}
                riderColorMap={riderColorMap}
                riderNameMap={riderNameMap}
                dateFrom={dateFrom}
                dateTo={dateTo}
                routeCategories={routes}
                includeOther={includeOther}
                onToggleRider={handleToggleRider}
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
                  onSortChange={(col, d) => updateSearch({ sort: col, dir: d })}
                  density={density}
                  isAllTime={!dateFrom && !dateTo}
                  includeOther={includeOther}
                  chartOpen={chartOpen}
                  selectedRiderIds={selectedRiderIds}
                  onToggleRider={handleToggleRider}
                  onSelectAllRiders={handleSelectAllRiders}
                  onDeselectAllRiders={handleDeselectAllRiders}
                />
              )}
            </>
          ) : view === 'rides' ? (
            <RidesLeaderboardTable
              data={ridesQuery.data}
              isLoading={ridesQuery.isLoading}
              sortBy={rSort}
              sortDir={rDir}
              onSortChange={(col, d) => updateSearch({ rSort: col, rDir: d, page: 1 })}
              onPageChange={(p) => updateSearch({ page: p })}
              activeUser={user}
              onClearUser={() => updateSearch({ user: undefined, page: 1 })}
            />
          ) : (
            <AllTimeTable
              data={allTimeQuery.data}
              isLoading={allTimeQuery.isLoading}
              searchFilter={search}
              durationLabel={getDurationLabel(duration)}
              pprActive={ppr}
              pprDawnRiderIds={pprDawnRiderIds}
              onViewRides={(userId, dateFrom, dateTo) =>
                updateSearch({
                  view: 'rides',
                  user: userId,
                  dateFrom,
                  dateTo,
                  datePreset: undefined,
                  page: 1,
                })
              }
            />
          )}
        </div>
      </div>

      {/* ---- Mobile: Bottom bar ---- */}
      <MobileBottomBar
        onToggleGraph={() => setMobileGraphOpen((prev) => !prev)}
        onToggleSettings={() => setMobileSettingsOpen((prev) => !prev)}
        isGraphOpen={mobileGraphOpen}
        isSettingsOpen={mobileSettingsOpen}
      />

      {/* ---- Mobile: Settings panel (slide-up drawer) ---- */}
      <MobileSettingsPanel
        isOpen={mobileSettingsOpen}
        onClose={() => setMobileSettingsOpen(false)}
        search={search}
        onSearchChange={(value) => updateSearch({ search: value, page: 1 })}
        view={view}
        density={density}
        onDensityChange={(d) => updateSearch({ density: d })}
        duration={duration}
        onDurationChange={(d) => updateSearch({ duration: d })}
        selectedRoutes={routes}
        onRoutesChange={(r) => updateSearch({ routes: r, page: 1 })}
        pprActive={ppr}
        onPprChange={(v) => updateSearch({ ppr: v })}
        weekendsActive={weekends}
        onWeekendsChange={(v) => updateSearch({ weekends: v })}
        includeOther={includeOther}
        onOtherChange={(v) => updateSearch({ other: v })}
        selectedCompany={company as DestinationCompany | undefined}
        onCompanyChange={(c) => updateSearch({ company: c, page: 1 })}
        dateFrom={dateFrom}
        dateTo={dateTo}
        datePreset={datePreset}
        onDateChange={(from, to, preset) => updateSearch({ dateFrom: from, dateTo: to, datePreset: preset, page: 1 })}
        reverseActive={reverse}
        onReverseChange={(v) => updateSearch({ reverse: v })}
        hasActiveFilters={hasActiveFilters}
        onClearAll={handleClearAll}
      />

      {/* ---- Mobile: Full-screen graph overlay ---- */}
      {mobileGraphOpen && (
        <div className="mobile-graph-overlay">
          <button
            type="button"
            className="mobile-graph-overlay__close"
            onClick={() => setMobileGraphOpen(false)}
            aria-label="Close graph"
          >
            ✕
          </button>
          <div className="mobile-graph-overlay__content">
            {growthData && growthData.length > 0 ? (
              <GrowthChart
                growthData={growthData}
                dailyData={dailyData}
                visibleRiderIds={selectedRiderArray}
                riderColorMap={riderColorMap}
                riderNameMap={riderNameMap}
                dateFrom={dateFrom}
                dateTo={dateTo}
                routeCategories={routes}
                includeOther={includeOther}
                onToggleRider={handleToggleRider}
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
          </div>
        </div>
      )}
    </section>
  )
}
