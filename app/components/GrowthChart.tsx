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
import type { DailyRideStat } from '../server/leaderboard'

interface GrowthChartProps {
  growthData: MonthlyRideStat[]
  dailyData?: DailyRideStat[]
  visibleRiderIds: string[]
  riderColorMap: Map<string, string>
  riderNameMap: Map<string, string>
  dateFrom?: string
  dateTo?: string
  routeCategories?: RouteCategory[]
  includeOther?: boolean
  onToggleRider?: (userId: string) => void
}

// ---------------------------------------------------------------------------
// Granularity detection
// ---------------------------------------------------------------------------
type Granularity = 'daily' | 'weekly' | 'monthly'

/**
 * Determine chart granularity based on the date range span in days.
 * - ≤ 90 days  → daily
 * - ≤ 365 days → weekly
 * - > 365 days → monthly
 */
function detectGranularity(dateFrom?: string, dateTo?: string): Granularity {
  if (!dateFrom || !dateTo) return 'monthly'
  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  const diffDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 90) return 'daily'
  if (diffDays <= 365) return 'weekly'
  return 'monthly'
}

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

/** Format a YYYY-MM string to a short label like "Jan 25". */
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

/** Format a YYYY-MM-DD string to a short daily label like "Jun 1". */
function formatDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format a week label using just the week start date, e.g. "Jun 2". */
function formatWeekLabel(_weekKey: string, weekStart: Date): string {
  return weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Get the Monday-based ISO week key (YYYY-WXX) for a date. */
function getWeekKey(dateStr: string): { key: string; weekStart: Date } {
  const date = new Date(dateStr)
  // Find Monday of this week
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(date)
  monday.setDate(monday.getDate() + diffToMonday)

  // ISO week number
  const jan4 = new Date(monday.getFullYear(), 0, 4)
  const diffToJan4Monday = jan4.getDay() === 0 ? -6 : 1 - jan4.getDay()
  const jan4Monday = new Date(jan4)
  jan4Monday.setDate(jan4Monday.getDate() + diffToJan4Monday)
  const weekNum = Math.ceil(((monday.getTime() - jan4Monday.getTime()) / (1000 * 60 * 60 * 24) + 1) / 7)

  return {
    key: `${monday.getFullYear()}-W${String(weekNum).padStart(2, '0')}`,
    weekStart: monday,
  }
}

/**
 * Format a zero-point label: the time bucket before the given first bucket.
 */
function formatZeroLabel(firstBucket: string, granularity: Granularity): string {
  if (granularity === 'daily') {
    const [year, month, day] = firstBucket.split('-')
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    date.setDate(date.getDate() - 1)
    return formatDayLabel(date.toISOString().slice(0, 10))
  }
  if (granularity === 'monthly') {
    const [year, month] = firstBucket.split('-')
    const date = new Date(Number(year), Number(month) - 2)
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  // weekly — handled separately via weekStartMap
  return ''
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Mobile detection hook
// ---------------------------------------------------------------------------
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])

  return isMobile
}

// ---------------------------------------------------------------------------
// GrowthChart component
// ---------------------------------------------------------------------------
export function GrowthChart({
  growthData,
  dailyData,
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
  const granularity = detectGranularity(dateFrom, dateTo)

  const chartData = useMemo(() => {
    const riderIds = visibleRiderIds
    if (riderIds.length === 0) return []
    const riderIdSet = new Set(riderIds)

    // Route filter
    const activeRoutes = routeCategories && routeCategories.length > 0
      ? new Set(routeCategories)
      : null

    // ------------------------------------------------------------------
    // For daily/weekly granularity, use the per-ride dailyData if available
    // ------------------------------------------------------------------
    if ((granularity === 'daily' || granularity === 'weekly') && dailyData && dailyData.length > 0) {
      // Build per-rider, per-bucket ride counts
      // For daily: bucket key = "YYYY-MM-DD"
      // For weekly: bucket key = "YYYY-WXX"
      const weekStartMap = new Map<string, Date>() // for week label formatting
      const riderBuckets = new Map<string, Map<string, number>>()

      for (const ride of dailyData) {
        if (!riderIdSet.has(ride.user_id)) continue
        if (ride.route_category === null) continue
        if (!includeOther && ride.route_category === 'other') continue
        if (activeRoutes && !activeRoutes.has(ride.route_category)) continue

        // Date range filter
        if (dateFrom && ride.ride_date < dateFrom) continue
        if (dateTo && ride.ride_date > dateTo) continue

        let bucketKey: string
        if (granularity === 'daily') {
          bucketKey = ride.ride_date
        } else {
          const { key, weekStart } = getWeekKey(ride.ride_date)
          bucketKey = key
          if (!weekStartMap.has(key)) weekStartMap.set(key, weekStart)
        }

        let bucketMap = riderBuckets.get(ride.user_id)
        if (!bucketMap) {
          bucketMap = new Map<string, number>()
          riderBuckets.set(ride.user_id, bucketMap)
        }
        bucketMap.set(bucketKey, (bucketMap.get(bucketKey) ?? 0) + 1)
      }

      // Collect all buckets and sort
      const allBuckets = new Set<string>()
      for (const bucketMap of riderBuckets.values()) {
        for (const key of bucketMap.keys()) allBuckets.add(key)
      }
      const sortedBuckets = Array.from(allBuckets).sort()

      if (sortedBuckets.length === 0) return []

      // For daily: fill in missing days so the x-axis is continuous
      let filledBuckets: string[]
      if (granularity === 'daily' && sortedBuckets.length > 0) {
        filledBuckets = []
        const start = new Date(sortedBuckets[0])
        const end = new Date(sortedBuckets[sortedBuckets.length - 1])
        const cursor = new Date(start)
        while (cursor <= end) {
          filledBuckets.push(cursor.toISOString().slice(0, 10))
          cursor.setDate(cursor.getDate() + 1)
        }
      } else {
        filledBuckets = sortedBuckets
      }

      // Build cumulative data
      const cumulativeByRider = new Map<string, Map<string, number>>()
      for (const riderId of riderIds) {
        const bucketMap = riderBuckets.get(riderId)
        if (!bucketMap) continue
        let cumulative = 0
        const cumulativeMap = new Map<string, number>()
        for (const bucket of filledBuckets) {
          cumulative += bucketMap.get(bucket) ?? 0
          cumulativeMap.set(bucket, cumulative)
        }
        cumulativeByRider.set(riderId, cumulativeMap)
      }

      // Format labels
      const formatLabel = (bucket: string): string => {
        if (granularity === 'daily') return formatDayLabel(bucket)
        const weekStart = weekStartMap.get(bucket)
        if (weekStart) return formatWeekLabel(bucket, weekStart)
        return bucket
      }

      // Zero point
      const zeroLabel = granularity === 'daily'
        ? formatZeroLabel(filledBuckets[0], 'daily')
        : (() => {
            const firstWeekStart = weekStartMap.get(filledBuckets[0])
            if (firstWeekStart) {
              const prevWeekEnd = new Date(firstWeekStart)
              prevWeekEnd.setDate(prevWeekEnd.getDate() - 1)
              return formatDayLabel(prevWeekEnd.toISOString().slice(0, 10))
            }
            return ''
          })()

      const zeroPoint: Record<string, string | number> = { month: zeroLabel }
      for (const riderId of riderIds) {
        zeroPoint[riderId] = 0
      }

      const dataPoints = filledBuckets.map((bucket) => {
        const point: Record<string, string | number> = { month: formatLabel(bucket) }
        for (const riderId of riderIds) {
          const cumulativeMap = cumulativeByRider.get(riderId)
          point[riderId] = cumulativeMap?.get(bucket) ?? 0
        }
        return point
      })

      return [zeroPoint, ...dataPoints]
    }

    // ------------------------------------------------------------------
    // Monthly granularity: use the pre-aggregated monthly_ride_stats
    // ------------------------------------------------------------------
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
      const existing = monthMap.get(stat.month) ?? 0
      monthMap.set(stat.month, existing + stat.ride_count)
    }

    // Collect and sort months
    const allMonths = new Set<string>()
    for (const monthMap of riderMonthly.values()) {
      for (const month of monthMap.keys()) allMonths.add(month)
    }
    const sortedMonths = Array.from(allMonths).sort()

    // Date range filter for months
    const cutoffFrom = dateFrom ? dateFrom.slice(0, 7) : null
    const cutoffTo = dateTo ? dateTo.slice(0, 7) : null
    const filteredMonths = sortedMonths.filter((m) => {
      if (cutoffFrom && m < cutoffFrom) return false
      if (cutoffTo && m > cutoffTo) return false
      return true
    })

    // Build cumulative
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

    // Zero point
    const zeroPoint: Record<string, string | number> = {
      month: filteredMonths.length > 0
        ? formatZeroLabel(filteredMonths[0], 'monthly')
        : '',
    }
    for (const riderId of riderIds) {
      zeroPoint[riderId] = 0
    }

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
  }, [growthData, dailyData, visibleRiderIds, dateFrom, dateTo, routeCategories, includeOther, granularity])

  const riderIds = visibleRiderIds

  // Let Recharts auto-skip overlapping labels via minTickGap
  const minTickGap = granularity === 'daily' ? (isMobile ? 30 : 20)
    : granularity === 'weekly' ? (isMobile ? 40 : 25)
    : (isMobile ? 30 : 20)

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
            tick={{ fontSize: isMobile ? 10 : 11, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={minTickGap}
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
              dot={granularity === 'daily' ? false : { r: isMobile ? 1 : 2 }}
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
