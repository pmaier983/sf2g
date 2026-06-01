import { useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from 'recharts'
import type { CommunityBreakdown } from '../server/leaderboard'
import { useUnit } from '../lib/useUnit'
import { formatDistance, formatElevation } from '../lib/leaderboard-utils'

interface CommunityPieChartsProps {
  breakdown: CommunityBreakdown
}

const SF2G_COLOR = 'var(--color-strava)'
const SF2G_COLOR_HEX = '#FC4C02'
const OTHER_COLOR = 'var(--color-text-muted)'
const OTHER_COLOR_HEX = '#6B7280'

interface PieSlice {
  name: string
  value: number
  color: string
  colorHex: string
  pct: number
  displayValue: string
}



/**
 * Custom tooltip for the pie charts
 */
function PieTooltip({
  active,
  payload,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload as PieSlice

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
      <p style={{ fontWeight: 600, marginBottom: 2 }}>
        {data.name}
      </p>
      <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
        {data.displayValue} ({data.pct.toFixed(1)}%)
      </p>
    </div>
  )
}

/**
 * Renders the center label inside the donut chart
 */
function CenterLabel({
  cx,
  cy,
  pct,
  label,
}: {
  cx: number
  cy: number
  pct: number
  label: string
}) {
  return (
    <g>
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fill: 'var(--color-text)',
          fontSize: '1.5rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {pct.toFixed(0)}%
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fill: 'var(--color-text-muted)',
          fontSize: '0.65rem',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </text>
    </g>
  )
}

/**
 * CommunityPieCharts — Two donut charts showing what % of total
 * ride distance and elevation is SF2G commuting.
 */
export function CommunityPieCharts({ breakdown }: CommunityPieChartsProps) {
  const unit = useUnit()
  const distanceData = useMemo((): PieSlice[] => {
    const total = breakdown.total_distance_meters
    if (total === 0) return []
    const sf2gPct = (breakdown.sf2g_distance_meters / total) * 100
    return [
      {
        name: 'SF2G Commutes',
        value: breakdown.sf2g_distance_meters,
        color: SF2G_COLOR,
        colorHex: SF2G_COLOR_HEX,
        pct: sf2gPct,
        displayValue: formatDistance(breakdown.sf2g_distance_meters, unit),
      },
      {
        name: 'Other Rides',
        value: breakdown.other_distance_meters,
        color: OTHER_COLOR,
        colorHex: OTHER_COLOR_HEX,
        pct: 100 - sf2gPct,
        displayValue: formatDistance(breakdown.other_distance_meters, unit),
      },
    ]
  }, [breakdown, unit])

  const elevationData = useMemo((): PieSlice[] => {
    const total = breakdown.total_elevation_meters
    if (total === 0) return []
    const sf2gPct = (breakdown.sf2g_elevation_meters / total) * 100
    return [
      {
        name: 'SF2G Commutes',
        value: breakdown.sf2g_elevation_meters,
        color: SF2G_COLOR,
        colorHex: SF2G_COLOR_HEX,
        pct: sf2gPct,
        displayValue: formatElevation(breakdown.sf2g_elevation_meters, unit),
      },
      {
        name: 'Other Rides',
        value: breakdown.other_elevation_meters,
        color: OTHER_COLOR,
        colorHex: OTHER_COLOR_HEX,
        pct: 100 - sf2gPct,
        displayValue: formatElevation(breakdown.other_elevation_meters, unit),
      },
    ]
  }, [breakdown, unit])

  const sf2gDistancePct = breakdown.total_distance_meters > 0
    ? (breakdown.sf2g_distance_meters / breakdown.total_distance_meters) * 100
    : 0
  const sf2gElevationPct = breakdown.total_elevation_meters > 0
    ? (breakdown.sf2g_elevation_meters / breakdown.total_elevation_meters) * 100
    : 0

  if (distanceData.length === 0 && elevationData.length === 0) return null

  return (
    <div className="community-pies">
      <h3 className="community-pies__title">Community SF2G Share</h3>
      <div className="community-pies__grid">
        {/* Distance pie */}
        <div className="community-pies__chart">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={distanceData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={68}
                dataKey="value"
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {distanceData.map((entry) => (
                  <Cell key={entry.name} fill={entry.colorHex} />
                ))}
              </Pie>
              <Tooltip content={PieTooltip} />
              {/* Custom center label rendered via SVG */}
              <text
                x="50%"
                y="46%"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: 'var(--color-text)',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {sf2gDistancePct.toFixed(0)}%
              </text>
              <text
                x="50%"
                y="57%"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: 'var(--color-text-muted)',
                  fontSize: '0.6rem',
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                }}
              >
                DISTANCE
              </text>
            </PieChart>
          </ResponsiveContainer>
          <div className="community-pies__label">
            <span className="community-pies__label-value">
              {formatDistance(breakdown.sf2g_distance_meters, unit)}
            </span>
            <span className="community-pies__label-desc">
              of {formatDistance(breakdown.total_distance_meters, unit)} total
            </span>
          </div>
        </div>

        {/* Elevation pie */}
        <div className="community-pies__chart">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={elevationData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={68}
                dataKey="value"
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {elevationData.map((entry) => (
                  <Cell key={entry.name} fill={entry.colorHex} />
                ))}
              </Pie>
              <Tooltip content={PieTooltip} />
              <text
                x="50%"
                y="46%"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: 'var(--color-text)',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {sf2gElevationPct.toFixed(0)}%
              </text>
              <text
                x="50%"
                y="57%"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fill: 'var(--color-text-muted)',
                  fontSize: '0.6rem',
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                }}
              >
                ELEVATION
              </text>
            </PieChart>
          </ResponsiveContainer>
          <div className="community-pies__label">
            <span className="community-pies__label-value">
              {formatElevation(breakdown.sf2g_elevation_meters, unit)}
            </span>
            <span className="community-pies__label-desc">
              of {formatElevation(breakdown.total_elevation_meters, unit)} total
            </span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="community-pies__legend">
        <span className="community-pies__legend-item">
          <span className="community-pies__legend-dot" style={{ background: SF2G_COLOR_HEX }} />
          SF2G Commutes ({breakdown.sf2g_ride_count.toLocaleString()} rides)
        </span>
        <span className="community-pies__legend-item">
          <span className="community-pies__legend-dot" style={{ background: OTHER_COLOR_HEX }} />
          Other Rides ({breakdown.other_ride_count.toLocaleString()} rides)
        </span>
      </div>
    </div>
  )
}
