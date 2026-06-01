import { useMemo, useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { MonthlyRideStat } from '../lib/database.types'

type TimeRange = 'all' | '6m' | '1y' | '2y'

interface GrowthChartProps {
  growthData: MonthlyRideStat[]
  visibleRiderIds: string[]
  riderColorMap: Map<string, string>
  riderNameMap: Map<string, string>
  timeRange: TimeRange
  onTimeRangeChange: (range: TimeRange) => void
}

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '6m', label: '6mo' },
  { value: '1y', label: '1yr' },
  { value: '2y', label: '2yr' },
]

/**
 * Compute a cutoff ISO month string (YYYY-MM) based on the time range.
 * Returns `null` for 'all' (no filter).
 */
function getCutoffMonth(range: TimeRange): string | null {
  if (range === 'all') return null
  const now = new Date()
  const monthsBack = range === '6m' ? 6 : range === '1y' ? 12 : 24
  now.setMonth(now.getMonth() - monthsBack)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
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
 * over time for the top 10 visible riders.
 */
export function GrowthChart({
  growthData,
  visibleRiderIds,
  riderColorMap,
  riderNameMap,
  timeRange,
  onTimeRangeChange,
}: GrowthChartProps) {
  const isMobile = useIsMobile()

  const chartData = useMemo(() => {
    // Limit to the top 10 visible riders
    const riderIds = visibleRiderIds.slice(0, 10)
    if (riderIds.length === 0) return []

    const riderIdSet = new Set(riderIds)

    // Group monthly stats by rider, filtered to visible riders
    // Only include SF2G commutes (exclude 'other' category)
    const riderMonthly = new Map<string, Map<string, number>>()
    for (const stat of growthData) {
      if (!riderIdSet.has(stat.user_id)) continue
      if (stat.route_category === 'other' || stat.route_category === null) continue
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

    // Apply time range filter
    const cutoff = getCutoffMonth(timeRange)
    const filteredMonths = cutoff
      ? sortedMonths.filter((m) => m >= cutoff)
      : sortedMonths

    // Build cumulative data
    // First compute cumulative totals starting from the beginning
    const cumulativeByRider = new Map<string, Map<string, number>>()
    for (const riderId of riderIds) {
      const monthMap = riderMonthly.get(riderId)
      if (!monthMap) continue
      let cumulative = 0
      const cumulativeMap = new Map<string, number>()
      for (const month of sortedMonths) {
        cumulative += monthMap.get(month) ?? 0
        cumulativeMap.set(month, cumulative)
      }
      cumulativeByRider.set(riderId, cumulativeMap)
    }

    // Build the final data array with only filtered months
    return filteredMonths.map((month) => {
      const point: Record<string, string | number> = {
        month: formatMonthLabel(month),
      }
      for (const riderId of riderIds) {
        const cumulativeMap = cumulativeByRider.get(riderId)
        point[riderId] = cumulativeMap?.get(month) ?? 0
      }
      return point
    })
  }, [growthData, visibleRiderIds, timeRange])

  const riderIds = visibleRiderIds.slice(0, 10)

  if (chartData.length === 0) {
    return (
      <div className="leaderboard__growth-chart">
        <h2>Commute Growth — Top 10</h2>
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
          Commute Growth — Top 10
        </h2>
        <div className="leaderboard__time-range">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`leaderboard__time-range-btn${
                timeRange === opt.value ? ' leaderboard__time-range-btn--active' : ''
              }`}
              onClick={() => onTimeRangeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
            interval={isMobile ? 'preserveStartEnd' : 'equidistantPreserveStart'}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={(props: TooltipProps<number, string>) => (
              <GrowthTooltip {...props} riderNameMap={riderNameMap} />
            )}
          />
          {!isMobile && (
            <Legend
              formatter={(value: string) => riderNameMap.get(value) ?? value}
              wrapperStyle={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
              }}
            />
          )}
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
    </div>
  )
}

