import { msToMph, classifyWindEffect } from '../lib/wind'

interface WindIndicatorProps {
  tailwindMs: number | null
  windSpeedMs?: number | null
  windDirectionDeg?: number | null
}

/**
 * Inline component for showing wind effect on individual rides.
 * Displays tailwind/headwind in mph with color coding and emoji.
 */
export function WindIndicator({ tailwindMs, windSpeedMs, windDirectionDeg }: WindIndicatorProps) {
  // If no wind data, show nothing
  if (tailwindMs == null) return null

  const effect = classifyWindEffect(tailwindMs)
  const mph = msToMph(tailwindMs)
  const absMph = Math.abs(mph)
  const sign = mph > 0 ? '+' : ''

  // Color based on effect
  const colorMap: Record<ReturnType<typeof classifyWindEffect>, string> = {
    'strong-tailwind': 'var(--color-success)',
    'light-tailwind': 'var(--color-success)',
    'calm': 'var(--color-text-muted)',
    'light-headwind': 'var(--color-error)',
    'strong-headwind': 'var(--color-error)',
  }

  const label = mph > 0 ? 'tailwind' : mph < 0 ? 'headwind' : 'calm'

  // Show wind direction as compass if available
  const compass = windDirectionDeg != null ? degToCompass(windDirectionDeg) : ''
  const windInfo = windSpeedMs != null
    ? ` · ${msToMph(windSpeedMs).toFixed(0)} mph ${compass}`
    : ''

  return (
    <span
      className="wind-indicator"
      style={{ color: colorMap[effect] }}
      title={`${sign}${absMph.toFixed(1)} mph ${label}${windInfo}`}
    >
      🌬️ {sign}{absMph.toFixed(1)} mph {label}
    </span>
  )
}

/** Convert wind direction degrees to 16-point compass abbreviation */
function degToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(deg / 22.5) % 16
  return dirs[index]
}
