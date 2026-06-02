import { useMemo, useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { MonthlyRideStat, RouteCategory } from '../lib/database.types'

interface GrowthChartProps {
  growthData: MonthlyRideStat[]
  visibleRiderIds: string[]
  riderColorMap: Map<string, string>
  riderNameMap: Map<string, string>
  dateFrom?: string
  dateTo?: string
  routeCategories?: RouteCategory[]
  includeOther?: boolean
  onToggleRider?: (userId: string) => void
}

/**
 * Convert a YYYY-MM-DD date string to a YYYY-MM month string.
 * Returns null if input is undefined.
 */
function dateToMonth(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  return dateStr.slice(0, 7) // "2024-01-15" → "2024-01"
}

/**
 * Format a YYYY-MM string to a short label like "Jan 25".
 */
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/**
 * Format a zero-point label: the month before the given YYYY-MM string.
 * e.g., "2025-01" → "Dec 24"
 */
function formatZeroLabel(firstMonth: string): string {
  const [year, month] = firstMonth.split('-')
  const date = new Date(Number(year), Number(month) - 2) // month - 1 for 0-index, - 1 more for previous
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/**
 * Custom tooltip matching the existing RideFrequencyChart tooltip style.
 */
function GrowthTooltip({
  active,
  payload,
  label,
  riderNameMap,
}: TooltipProps<number, string> & { riderNameMap: Map<string, string> }) {
  if (!active || !payload?.length) return null

  return (
    <div
      style={{
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text)',
        padding: '8px 12px',
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map((entry) => (
        <p
          key={entry.dataKey}
          style={{ color: entry.color, margin: '2px 0' }}
        >
          {riderNameMap.get(String(entry.dataKey)) ?? entry.dataKey}:{' '}
          {entry.value} rides
        </p>
      ))}
    </div>
  )
}

/**
 * Hook to detect mobile viewport for responsive chart sizing.
 */
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile via matchMedia after hydration
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])

  return isMobile
}

/**
 * GrowthChart — Recharts LineChart showing cumulative ride count growth
 * over time for the selected riders.
 */
export function GrowthChart({
  growthData,
  visibleRiderIds,
  riderColorMap,
  riderNameMap,
  dateFrom,
  dateTo,
  routeCategories,
  includeOther = false,
  onToggleRider,
}: GrowthChartProps) {
  const isMobile = useIsMobile()

  const chartData = useMemo(() => {
    const riderIds = visibleRiderIds
    if (riderIds.length === 0) return []

    const riderIdSet = new Set(riderIds)

    // Group monthly stats by rider, filtered to visible riders
    // When route categories are specified, only count those routes
    // Otherwise include all SF2G commutes (exclude 'other' unless toggled on)
    const activeRoutes = routeCategories && routeCategories.length > 0
      ? new Set(routeCategories)
      : null
    const riderMonthly = new Map<string, Map<string, number>>()
    for (const stat of growthData) {
      if (!riderIdSet.has(stat.user_id)) continue
      if (stat.route_category === null) continue
      if (!includeOther && stat.route_category === 'other') continue
      if (activeRoutes && !activeRoutes.has(stat.route_category)) continue
      let monthMap = riderMonthly.get(stat.user_id)
      if (!monthMap) {
        monthMap = new Map<string, number>()
        riderMonthly.set(stat.user_id, monthMap)
      }
      // Aggregate all route categories for this rider+month
      const existing = monthMap.get(stat.month) ?? 0
      monthMap.set(stat.month, existing + stat.ride_count)
    }

    // Collect all unique months and sort ascending
    const allMonths = new Set<string>()
    for (const monthMap of riderMonthly.values()) {
      for (const month of monthMap.keys()) {
        allMonths.add(month)
      }
    }
    const sortedMonths = Array.from(allMonths).sort()

    // Apply date range filter (months are YYYY-MM, dates are YYYY-MM-DD)
    const cutoffFrom = dateToMonth(dateFrom)
    const cutoffTo = dateToMonth(dateTo)
    const filteredMonths = sortedMonths.filter((m) => {
      if (cutoffFrom && m < cutoffFrom) return false
      if (cutoffTo && m > cutoffTo) return false
      return true
    })

    // Build cumulative data within the filtered date window
    // Accumulates only from filteredMonths so everyone starts at 0
    const cumulativeByRider = new Map<string, Map<string, number>>()
    for (const riderId of riderIds) {
      const monthMap = riderMonthly.get(riderId)
      if (!monthMap) continue
      let cumulative = 0
      const cumulativeMap = new Map<string, number>()
      for (const month of filteredMonths) {
        cumulative += monthMap.get(month) ?? 0
        cumulativeMap.set(month, cumulative)
      }
      cumulativeByRider.set(riderId, cumulativeMap)
    }

    // Prepend a zero-point so all lines visibly start at 0
    const zeroPoint: Record<string, string | number> = {
      month: filteredMonths.length > 0
        ? formatZeroLabel(filteredMonths[0])
        : '',
    }
    for (const riderId of riderIds) {
      zeroPoint[riderId] = 0
    }

    // Build the final data array with only filtered months
    const dataPoints = filteredMonths.map((month) => {
      const point: Record<string, string | number> = {
        month: formatMonthLabel(month),
      }
      for (const riderId of riderIds) {
        const cumulativeMap = cumulativeByRider.get(riderId)
        point[riderId] = cumulativeMap?.get(month) ?? 0
      }
      return point
    })

    return [zeroPoint, ...dataPoints]
  }, [growthData, visibleRiderIds, dateFrom, dateTo, routeCategories, includeOther])

  const riderIds = visibleRiderIds

  if (chartData.length === 0) {
    return (
      <div className="leaderboard__growth-chart">
        <h2>Commute Growth</h2>
        <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
          <div className="empty-state__icon">📈</div>
          <h3 className="empty-state__title">No growth data</h3>
          <p className="empty-state__description">
            Ride data will appear here once riders have monthly stats.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="leaderboard__growth-chart">
      <div className="leaderboard__growth-header">
        <h2 className="leaderboard__growth-title">
          Commute Growth
        </h2>
      </div>
      <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: isMobile ? 10 : 12, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            interval={chartData.length <= 18 ? 0 : isMobile ? 'preserveStartEnd' : 'equidistantPreserveStart'}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <RechartsTooltip
            content={(props: TooltipProps<number, string>) => (
              <GrowthTooltip {...props} riderNameMap={riderNameMap} />
            )}
          />
          {riderIds.map((riderId) => (
            <Line
              key={riderId}
              type="monotone"
              dataKey={riderId}
              name={riderId}
              stroke={riderColorMap.get(riderId) ?? 'var(--color-text-muted)'}
              strokeWidth={2}
              dot={{ r: isMobile ? 1 : 2 }}
              activeDot={{ r: isMobile ? 3 : 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Custom clickable legend */}
      {!isMobile && riderIds.length > 0 && (
        <div className="growth-chart__legend">
          {riderIds.map((riderId) => {
            const color = riderColorMap.get(riderId) ?? 'var(--color-text-muted)'
            const name = riderNameMap.get(riderId) ?? riderId
            return (
              <button
                key={riderId}
                type="button"
                className="growth-chart__legend-item"
                onClick={() => onToggleRider?.(riderId)}
                title={`Remove ${name} from chart`}
              >
                <span
                  className="growth-chart__legend-dot"
                  style={{ background: color }}
                />
                <span className="growth-chart__legend-name">{name}</span>
                <span className="growth-chart__legend-remove">×</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

