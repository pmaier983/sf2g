/**
 * RideSummaryCards — 4 summary cards showing key forecast stats.
 *
 * Displays: Avg Temperature, Cloud Cover, Avg Visibility, Avg Wind Speed
 * Each card has an icon, value, label, and color-coded severity.
 */
import type { ForecastResult } from '../server/forecast'
import { Tooltip } from './Tooltip'

interface RideSummaryCardsProps {
  summary: ForecastResult['summary']
}

function getTempSeverity(temp: number): string {
  if (temp < 40) return 'var(--color-info)'
  if (temp < 50) return 'var(--color-skyline)'
  if (temp < 65) return 'var(--color-success)'
  if (temp < 80) return 'var(--color-warning)'
  return 'var(--color-error)'
}

function getCloudSeverity(cloud: number): string {
  if (cloud < 25) return 'var(--color-success)'
  if (cloud < 50) return 'var(--color-warning)'
  if (cloud < 75) return 'var(--color-sf2g-orange)'
  return 'var(--color-text-muted)'
}

function getVisibilitySeverity(vis: number): string {
  if (vis > 10000) return 'var(--color-success)'
  if (vis > 5000) return 'var(--color-warning)'
  return 'var(--color-error)'
}

function getWindSeverity(wind: number): string {
  if (wind < 8) return 'var(--color-success)'
  if (wind < 15) return 'var(--color-warning)'
  if (wind < 25) return 'var(--color-sf2g-orange)'
  return 'var(--color-error)'
}

function formatVisibility(meters: number): string {
  const km = meters / 1000
  if (km >= 10) return `${Math.round(km)} km`
  return `${km.toFixed(1)} km`
}

export function RideSummaryCards({ summary }: RideSummaryCardsProps) {
  const cards = [
    {
      icon: '🌡️',
      value: `${Math.round(summary.avgTemp)}°F`,
      label: 'Avg Temp',
      color: getTempSeverity(summary.avgTemp),
      tooltip: `Average temperature along the route`,
    },
    {
      icon: '☁️',
      value: `${summary.avgCloudCover}%`,
      label: 'Cloud Cover',
      color: getCloudSeverity(summary.avgCloudCover),
      tooltip: `Average cloud cover percentage`,
    },
    {
      icon: '👁️',
      value: formatVisibility(summary.avgVisibility),
      label: 'Visibility',
      color: getVisibilitySeverity(summary.avgVisibility),
      tooltip: `Average visibility along the route`,
    },
    {
      icon: '💨',
      value: `${summary.avgWindSpeed} mph`,
      label: 'Avg Wind',
      color: getWindSeverity(summary.avgWindSpeed),
      tooltip: `Average wind speed along the route`,
    },
  ]

  return (
    <div className="forecast-summary">
      {cards.map((card) => (
        <Tooltip key={card.label} content={card.tooltip}>
          <div
            className="forecast-summary__card"
            style={{ borderTopColor: card.color }}
          >
            <span className="forecast-summary__icon">{card.icon}</span>
            <span
              className="forecast-summary__value"
              style={{ color: card.color }}
            >
              {card.value}
            </span>
            <span className="forecast-summary__label">{card.label}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  )
}
