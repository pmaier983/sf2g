import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Ride, RouteCategory } from '../lib/database.types'
import { ROUTE_COLORS, ROUTE_LABELS } from '../lib/constants'

interface YearlyData {
  year: string
  bayway: number
  skyline: number
  hmbw: number
  royale: number
  fleaway: number
  mebw: number
  febw: number
  other: number
}

/**
 * RideFrequencyChart — Recharts stacked bar chart showing yearly ride counts
 * by route category.
 */
export function RideFrequencyChart({ rides }: { rides: Ride[] }) {
  const yearlyData = aggregateByYear(rides)

  if (yearlyData.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 'var(--space-6)' }}>
        <div className="empty-state__icon">📊</div>
        <h3 className="empty-state__title">No ride data yet</h3>
        <p className="empty-state__description">
          Sync your rides to see your yearly activity chart.
        </p>
      </div>
    )
  }

  const categories: RouteCategory[] = ['bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other']

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={yearlyData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text)',
            }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
            }}
          />
          {categories.map((cat) => (
            <Bar
              key={cat}
              dataKey={cat}
              name={ROUTE_LABELS[cat]}
              fill={ROUTE_COLORS[cat]}
              stackId="rides"
              radius={cat === 'other' ? [0, 0, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Aggregate rides by year and route category.
 */
function aggregateByYear(rides: Ride[]): YearlyData[] {
  const map = new Map<string, YearlyData>()

  for (const ride of rides) {
    const date = new Date(ride.ride_date)
    // Use getUTCFullYear since date-only strings ("YYYY-MM-DD") are parsed as UTC midnight
    const key = String(date.getUTCFullYear())

    let entry = map.get(key)
    if (!entry) {
      entry = { year: key, bayway: 0, skyline: 0, hmbw: 0, royale: 0, fleaway: 0, mebw: 0, febw: 0, other: 0 }
      map.set(key, entry)
    }

    const cat = ride.route_category
    // Skip non-SF2G rides (null route_category)
    if (!cat) continue
    if (cat in entry) {
      entry[cat as keyof Omit<YearlyData, 'year'>]++
    }
  }

  // Sort by year ascending
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
}
