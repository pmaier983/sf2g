/**
 * ProfileRideStats — pie chart of SF2G ride route distribution + summary stats.
 *
 * Shows:
 * - Donut chart with ride counts per route category (bayway, skyline, etc.)
 * - Stats cards: % SF2G mileage, % SF2G elevation, total SF2G rides, avg speed
 */
import { useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  type TooltipProps,
} from 'recharts'
import type { Ride, RouteCategory } from '../lib/database.types'
import { useUnit } from '../lib/useUnit'
import {
  formatDistance,
  formatElevation,
  formatSpeed,
} from '../lib/leaderboard-utils'

interface ProfileRideStatsProps {
  rides: Ride[]
}

/** Route display config — matches app's CSS custom properties */
const ROUTE_CONFIG: Record<string, { label: string; color: string }> = {
  bayway: { label: 'Bayway', color: '#22A722' },
  skyline: { label: 'Skyline', color: '#3366CC' },
  hmbw: { label: 'HMBW', color: '#FF6600' },
  royale: { label: 'Royale', color: '#CC0000' },
  fleaway: { label: 'Fleaway', color: '#8B5CF6' },
  mebw: { label: 'MEBW', color: '#06B6D4' },
  febw: { label: 'FEBW', color: '#EC4899' },
  other: { label: 'Other', color: '#6B7280' },
}

interface PieSlice {
  name: string
  value: number
  color: string
  pct: number
}

/**
 * Custom tooltip for the route pie chart
 */
function RouteTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload as PieSlice

  return (
    <div
      style={{
        background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        padding: '8px 12px',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: data.color,
          }}
        />
        <strong>{data.name}</strong>
      </div>
      <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
        {data.value} ride{data.value !== 1 ? 's' : ''} ({data.pct.toFixed(1)}%)
      </div>
    </div>
  )
}

export function ProfileRideStats({ rides }: ProfileRideStatsProps) {
  const unit = useUnit()

  const stats = useMemo(() => {
    // Classify rides
    const sf2gRides = rides.filter(
      (r) => r.route_category != null && r.route_category !== 'other',
    )
    const otherSf2g = rides.filter((r) => r.route_category === 'other')
    const allSf2g = [...sf2gRides, ...otherSf2g]

    // Route breakdown for pie chart
    const routeCounts = new Map<string, number>()
    for (const ride of allSf2g) {
      const cat = ride.route_category ?? 'other'
      routeCounts.set(cat, (routeCounts.get(cat) ?? 0) + 1)
    }

    const totalSf2g = allSf2g.length
    const pieData: PieSlice[] = []
    for (const [cat, count] of routeCounts) {
      const config = ROUTE_CONFIG[cat]
      if (config && count > 0) {
        pieData.push({
          name: config.label,
          value: count,
          color: config.color,
          pct: totalSf2g > 0 ? (count / totalSf2g) * 100 : 0,
        })
      }
    }

    // Sort by count descending
    pieData.sort((a, b) => b.value - a.value)

    // Mileage stats
    const sf2gDistance = allSf2g.reduce(
      (sum, r) => sum + (r.distance_meters ?? 0),
      0,
    )

    // Elevation stats
    const sf2gElevation = allSf2g.reduce(
      (sum, r) => sum + (r.elevation_gain_meters ?? 0),
      0,
    )

    // Avg speed (SF2G rides only, excluding 'other' to match leaderboard)
    const speedRides = sf2gRides
    const speedSum = speedRides.reduce(
      (sum, r) => sum + (r.average_speed_mps ?? 0),
      0,
    )
    const speedCount = speedRides.filter(
      (r) => r.average_speed_mps != null,
    ).length
    const avgSpeedMps = speedCount > 0 ? speedSum / speedCount : 0

    return {
      pieData,
      sf2gCount: allSf2g.length,
      sf2gDistance,
      sf2gElevation,
      avgSpeedMps,
    }
  }, [rides])

  if (rides.length === 0) return null

  return (
    <div className="profile-stats">
      {/* Stats cards row */}
      <div className="profile-stats__cards">
        <div className="profile-stats__card">
          <span className="profile-stats__card-value">
            {stats.sf2gCount}
          </span>
          <span className="profile-stats__card-label">SF2G Rides</span>
        </div>
        <div className="profile-stats__card">
          <span className="profile-stats__card-value">
            {formatDistance(stats.sf2gDistance, unit)}
          </span>
          <span className="profile-stats__card-label">
            SF2G Distance
          </span>
        </div>
        <div className="profile-stats__card">
          <span className="profile-stats__card-value">
            {formatElevation(stats.sf2gElevation, unit)}
          </span>
          <span className="profile-stats__card-label">
            SF2G Elevation
          </span>
        </div>
        <div className="profile-stats__card">
          <span className="profile-stats__card-value">
            {stats.avgSpeedMps > 0
              ? formatSpeed(stats.avgSpeedMps, unit)
              : '—'}
          </span>
          <span className="profile-stats__card-label">
            Avg SF2G Speed
          </span>
        </div>
      </div>

      {/* Pie chart */}
      {stats.pieData.length > 0 && (
        <div className="profile-stats__chart">
          <h3 className="profile-stats__chart-title">Route Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={stats.pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {stats.pieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<RouteTooltip />} />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
                iconSize={10}
                formatter={(value: string) => (
                  <span style={{ color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
