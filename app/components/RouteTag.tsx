import type { RouteCategory } from '../lib/database.types'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'

/**
 * RouteTag — color-coded route category badge.
 * Displays a small dot + route label with route-specific colors.
 */
export function RouteTag({
  category,
  size = 'sm',
}: {
  category: RouteCategory
  size?: 'sm' | 'md'
}) {
  const label = ROUTE_LABELS[category]
  const color = ROUTE_COLORS[category]

  return (
    <span className={`route-tag route-tag--${category}`}>
      <span
        className="route-tag__dot"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}
