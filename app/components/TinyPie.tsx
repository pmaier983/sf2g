import { safeNumber, sf2gSharePct, formatDistance, formatElevation } from '../lib/leaderboard-utils'
import { useUnit } from '../lib/useUnit'

interface TinyPieProps {
  /** SF2G-only value (distance or elevation in meters) */
  sf2gValue: number
  /** Total value including non-SF2G (distance or elevation in meters) */
  totalValue: number
  /** 'distance' renders miles, 'elevation' renders feet */
  kind: 'distance' | 'elevation'
  /** SVG diameter in px */
  size?: number
}

/**
 * TinyPie — a lightweight SVG donut indicator showing what % of a
 * rider's total distance or elevation is SF2G commuting.
 * Uses raw SVG (no Recharts) for minimal overhead in virtualized rows.
 */
export function TinyPie({
  sf2gValue,
  totalValue,
  kind,
  size = 28,
}: TinyPieProps) {
  const total = safeNumber(totalValue)
  const sf2g = safeNumber(sf2gValue)
  const unit = useUnit()

  if (total === 0) {
    return <span className="leaderboard__route-count" style={{ color: 'var(--color-text-muted)' }}>—</span>
  }

  const pct = sf2gSharePct(sf2g, total)

  // Compute color interpolation from grey to Strava orange based on percentage
  // At 0%: var(--color-text-muted) (grey)
  // At 100%: #FC4C02 (Strava orange)
  const gradientColor = `color-mix(in srgb, #FC4C02 ${Math.round(pct)}%, var(--color-text-muted))`
  const colorStyle = { color: gradientColor }
  const radius = (size - 4) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (pct / 100) * circumference
  const center = size / 2

  // Format the tooltip value
  const formattedSf2g = kind === 'distance' ? formatDistance(sf2g, unit) : formatElevation(sf2g, unit)
  const formattedTotal = kind === 'distance' ? formatDistance(total, unit) : formatElevation(total, unit)

  const label = kind === 'distance' ? 'dist' : 'elev'

  return (
    <span
      className="tiny-pie"
      title={`${pct.toFixed(0)}% SF2G ${label}: ${formattedSf2g} of ${formattedTotal} (active SF2G years only)`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block' }}
      >
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={3}
        />
        {/* Filled arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={gradientColor}
          strokeWidth={3}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeDashoffset={circumference * 0.25}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.3s ease' }}
        />
      </svg>
      <span className="tiny-pie__label" style={colorStyle}>{pct.toFixed(0)}%</span>
    </span>
  )
}
