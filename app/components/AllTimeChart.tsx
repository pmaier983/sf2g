/**
 * AllTimeChart — cumulative ride progress chart for the All Time view.
 *
 * Shows each selected rider's cumulative ride count over their best window,
 * normalized to day offsets (Day 0 = window start, Day N = durationDays).
 */
import { useMemo } from 'react'
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
import type { AllTimeEntry } from '../server/alltime'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface AllTimeChartProps {
  data: AllTimeEntry[]
  durationDays: number
  durationLabel: string
  riderColorMap: Map<string, string>
  riderNameMap: Map<string, string>
  selectedRiderIds: Set<string>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MS_PER_DAY = 1000 * 60 * 60 * 24

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function AllTimeTooltip({
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
      <p style={{ fontWeight: 600, marginBottom: 4 }}>Day {label}</p>
      {payload
        .filter((entry) => (entry.value ?? 0) > 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        .map((entry) => (
          <p
            key={entry.dataKey}
            style={{ color: entry.color, margin: '2px 0' }}
          >
            {riderNameMap.get(String(entry.dataKey)) ?? entry.dataKey}:{' '}
            {entry.value} ride{entry.value !== 1 ? 's' : ''}
          </p>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AllTimeChart component
// ---------------------------------------------------------------------------
export function AllTimeChart({
  data,
  durationDays,
  durationLabel,
  riderColorMap,
  riderNameMap,
  selectedRiderIds,
}: AllTimeChartProps) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0 || selectedRiderIds.size === 0) return []

    // Filter to selected riders (max 10)
    const selectedEntries = data
      .filter((e) => selectedRiderIds.has(e.userId) && e.rideDatesInWindow?.length > 0)
      .slice(0, 10)

    if (selectedEntries.length === 0) return []

    // Build per-rider cumulative counts at each day offset
    const riderCumulatives = new Map<string, Map<number, number>>()

    for (const entry of selectedEntries) {
      const windowStart = new Date(entry.windowStart).getTime()
      const dayCounts = new Map<number, number>()

      // Count rides per day offset
      for (const dateStr of entry.rideDatesInWindow) {
        const dayOffset = Math.floor((new Date(dateStr).getTime() - windowStart) / MS_PER_DAY)
        dayCounts.set(dayOffset, (dayCounts.get(dayOffset) ?? 0) + 1)
      }

      // Build cumulative map
      const cumulative = new Map<number, number>()
      let total = 0
      for (let day = 0; day <= durationDays; day++) {
        total += dayCounts.get(day) ?? 0
        cumulative.set(day, total)
      }

      riderCumulatives.set(entry.userId, cumulative)
    }

    // Build chart data array: one entry per day
    const points: Array<Record<string, number>> = []
    for (let day = 0; day <= durationDays; day++) {
      const point: Record<string, number> = { day }
      for (const [userId, cumulative] of riderCumulatives) {
        point[userId] = cumulative.get(day) ?? 0
      }
      points.push(point)
    }

    return points
  }, [data, durationDays, selectedRiderIds])

  // Determine which rider IDs have data
  const activeRiderIds = useMemo(() => {
    if (!data) return []
    return data
      .filter((e) => selectedRiderIds.has(e.userId) && e.rideDatesInWindow?.length > 0)
      .slice(0, 10)
      .map((e) => e.userId)
  }, [data, selectedRiderIds])

  if (selectedRiderIds.size === 0 || chartData.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <p>Select riders from the table to see their progress.</p>
      </div>
    )
  }

  // X-axis tick interval: show every day for 1w, every 5 days for 1m, every 30 days for 1y
  const tickInterval = durationDays <= 7 ? 1 : durationDays <= 31 ? 5 : 30

  return (
    <div>
      <h3
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 'var(--font-semibold)',
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
          marginTop: 0,
        }}
      >
        Best {durationLabel} Window
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(day: number) => `Day ${day}`}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            interval={tickInterval - 1}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            width={30}
          />
          <RechartsTooltip
            content={(props: TooltipProps<number, string>) => (
              <AllTimeTooltip {...props} riderNameMap={riderNameMap} />
            )}
          />
          {activeRiderIds.map((userId) => (
            <Line
              key={userId}
              type="stepAfter"
              dataKey={userId}
              stroke={riderColorMap.get(userId) ?? 'var(--color-sf2g-orange)'}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
