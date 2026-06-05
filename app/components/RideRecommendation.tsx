/**
 * RideRecommendation — Go / Maybe / No recommendation banner.
 *
 * Shows a large verdict at the top of the forecast with:
 * - YES / MAYBE / NO in a large, color-coded badge
 * - Certainty percentage
 * - Wind effect indicator (headwind/tailwind)
 * - Rain probability
 * - Fog probability
 */
import type { ForecastResult } from '../server/forecast'

interface RideRecommendationProps {
  summary: ForecastResult['summary']
}

interface Verdict {
  decision: 'YES' | 'MAYBE' | 'NO'
  certainty: number // 0–100
  reasons: string[]
}

/**
 * WMO weather codes that indicate bad conditions.
 * 63+ = moderate/heavy rain, snow, storms
 */
const BAD_WEATHER_CODES = new Set([63, 65, 71, 73, 75, 80, 81, 82, 95, 96, 99])

/**
 * WMO codes for marginal conditions (fog, drizzle, light rain).
 */
const MARGINAL_WEATHER_CODES = new Set([45, 48, 51, 53, 55, 61])

/**
 * Compute the ride recommendation from forecast summary data.
 */
function computeVerdict(summary: ForecastResult['summary']): Verdict {
  const reasons: string[] = []
  let score = 100 // Start perfect, deduct for problems

  // --- NO conditions (deal-breakers) ---

  // Heavy rain
  if (summary.maxPrecipProb > 60) {
    score -= 60
    reasons.push(`High rain probability (${summary.maxPrecipProb}%)`)
  } else if (summary.maxPrecipProb > 30) {
    score -= 25
    reasons.push(`Moderate rain chance (${summary.maxPrecipProb}%)`)
  } else if (summary.maxPrecipProb > 10) {
    score -= 10
    reasons.push(`Slight rain chance (${summary.maxPrecipProb}%)`)
  }

  // Freezing temps
  if (summary.avgTemp < 35) {
    score -= 50
    reasons.push(`Near-freezing temperature (${summary.avgTemp}°F)`)
  } else if (summary.avgTemp < 45) {
    score -= 15
    reasons.push(`Cold temperature (${summary.avgTemp}°F)`)
  }

  // Storm-force winds
  if (summary.avgWindSpeed > 30) {
    score -= 55
    reasons.push(`Dangerous wind speeds (${summary.avgWindSpeed} mph)`)
  } else if (summary.avgWindSpeed > 20) {
    score -= 25
    reasons.push(`Strong winds (${summary.avgWindSpeed} mph)`)
  } else if (summary.avgWindSpeed > 15) {
    score -= 10
    reasons.push(`Moderate winds (${summary.avgWindSpeed} mph)`)
  }

  // Heavy headwind
  if (summary.avgHeadwind > 15) {
    score -= 20
    reasons.push(`Strong headwind (${summary.avgHeadwind} mph)`)
  } else if (summary.avgHeadwind > 8) {
    score -= 10
    reasons.push(`Moderate headwind (${summary.avgHeadwind} mph)`)
  } else if (summary.avgHeadwind < -5) {
    score += 5
    reasons.push(`Tailwind assist (${Math.abs(summary.avgHeadwind)} mph)`)
  }

  // Fog / low visibility
  if (summary.fogProbability > 50) {
    score -= 20
    reasons.push(`High fog probability (${summary.fogProbability}%)`)
  } else if (summary.fogProbability > 20) {
    score -= 10
    reasons.push(`Some fog expected (${summary.fogProbability}%)`)
  }

  // Cloud cover (mild impact)
  if (summary.avgCloudCover > 80) {
    score -= 5
    reasons.push(`Heavy cloud cover (${summary.avgCloudCover}%)`)
  }

  // Visibility
  if (summary.avgVisibility < 3000) {
    score -= 15
    reasons.push('Very low visibility')
  } else if (summary.avgVisibility < 5000) {
    score -= 5
    reasons.push('Reduced visibility')
  }

  // Clear conditions bonus
  if (
    summary.maxPrecipProb < 5 &&
    summary.avgWindSpeed < 10 &&
    summary.avgTemp > 50 &&
    summary.avgTemp < 75
  ) {
    score += 10
    reasons.push('Ideal riding conditions')
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score))

  let decision: 'YES' | 'MAYBE' | 'NO'
  if (score >= 65) decision = 'YES'
  else if (score >= 35) decision = 'MAYBE'
  else decision = 'NO'

  return { decision, certainty: score, reasons }
}

function getDecisionColor(decision: 'YES' | 'MAYBE' | 'NO'): string {
  switch (decision) {
    case 'YES':
      return 'var(--color-success)'
    case 'MAYBE':
      return 'var(--color-warning)'
    case 'NO':
      return 'var(--color-error)'
  }
}

function getDecisionEmoji(decision: 'YES' | 'MAYBE' | 'NO'): string {
  switch (decision) {
    case 'YES':
      return '✅'
    case 'MAYBE':
      return '🤔'
    case 'NO':
      return '❌'
  }
}

function getWindEffectLabel(effect: 'headwind' | 'tailwind' | 'crosswind'): {
  label: string
  icon: string
  color: string
} {
  switch (effect) {
    case 'tailwind':
      return { label: 'Tailwind', icon: '🌬️↗', color: 'var(--color-success)' }
    case 'headwind':
      return { label: 'Headwind', icon: '🌬️↙', color: 'var(--color-error)' }
    case 'crosswind':
      return { label: 'Crosswind', icon: '🌬️→', color: 'var(--color-warning)' }
  }
}

export function RideRecommendation({ summary }: RideRecommendationProps) {
  const verdict = computeVerdict(summary)
  const decisionColor = getDecisionColor(verdict.decision)
  const emoji = getDecisionEmoji(verdict.decision)
  const windEffect = getWindEffectLabel(summary.dominantWindEffect)

  return (
    <div className="ride-recommendation">
      {/* Main verdict */}
      <div className="ride-recommendation__verdict">
        <span className="ride-recommendation__emoji">{emoji}</span>
        <span
          className="ride-recommendation__decision"
          style={{ color: decisionColor }}
        >
          {verdict.decision}
        </span>
        <span
          className="ride-recommendation__certainty"
          style={{ color: decisionColor }}
        >
          {verdict.certainty}% confidence
        </span>
      </div>

      {/* Quick stats row */}
      <div className="ride-recommendation__stats">
        <div className="ride-recommendation__stat">
          <span
            className="ride-recommendation__stat-icon"
            style={{ color: windEffect.color }}
          >
            {windEffect.icon}
          </span>
          <span className="ride-recommendation__stat-label">
            {windEffect.label}
          </span>
          <span
            className="ride-recommendation__stat-value"
            style={{ color: windEffect.color }}
          >
            {Math.abs(summary.avgHeadwind)} mph
          </span>
        </div>

        <div className="ride-recommendation__stat-divider" />

        <div className="ride-recommendation__stat">
          <span className="ride-recommendation__stat-icon">🌧️</span>
          <span className="ride-recommendation__stat-label">Rain</span>
          <span
            className="ride-recommendation__stat-value"
            style={{
              color:
                summary.overallRainProb > 50
                  ? 'var(--color-error)'
                  : summary.overallRainProb > 20
                    ? 'var(--color-warning)'
                    : 'var(--color-success)',
            }}
          >
            {summary.overallRainProb}%
          </span>
        </div>

        <div className="ride-recommendation__stat-divider" />

        <div className="ride-recommendation__stat">
          <span className="ride-recommendation__stat-icon">🌫️</span>
          <span className="ride-recommendation__stat-label">Fog</span>
          <span
            className="ride-recommendation__stat-value"
            style={{
              color:
                summary.fogProbability > 50
                  ? 'var(--color-error)'
                  : summary.fogProbability > 20
                    ? 'var(--color-warning)'
                    : 'var(--color-success)',
            }}
          >
            {summary.fogProbability}%
          </span>
        </div>
      </div>
    </div>
  )
}

/** Re-export for use in DecisionLogic */
export { computeVerdict }
export type { Verdict }
