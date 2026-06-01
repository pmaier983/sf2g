import type { RouteCategory } from '../lib/database.types'
import {
  ROUTE_GATEWAYS,
  ROUTE_LABELS,
  ROUTE_DESCRIPTIONS,
  ROUTE_COLORS,
  type RouteGateway,
} from '../lib/constants'
import { RouteTag } from './RouteTag'

/**
 * RouteDetailCard — shows a route corridor with description and gateway info.
 */
export function RouteDetailCard({ category }: { category: RouteCategory }) {
  const gateways = ROUTE_GATEWAYS.filter((g) => g.category === category)

  return (
    <div className={`glass-card route-detail route-detail--${category}`}>
      <div className="route-detail__header">
        <RouteTag category={category} />
        <h3 className="route-detail__name">{ROUTE_LABELS[category]}</h3>
      </div>
      <p className="route-detail__desc">{ROUTE_DESCRIPTIONS[category]}</p>

      <div className="route-detail__gateways">
        <h4 className="route-detail__gateway-title">Gateway Checkpoints</h4>
        <div className="route-detail__gateway-list">
          {gateways.map((gw) => (
            <GatewayCard key={gw.name} gateway={gw} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GatewayCard({ gateway }: { gateway: RouteGateway }) {
  const mapsUrl = `https://www.google.com/maps?q=${gateway.lat},${gateway.lng}&z=15`

  return (
    <div className="route-detail__gateway">
      <p className="route-detail__gateway-name">{gateway.name}</p>
      <p className="route-detail__gateway-coords">
        {gateway.lat.toFixed(4)}°N, {Math.abs(gateway.lng).toFixed(4)}°W
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
        {gateway.description}
      </p>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="route-detail__gateway-link"
      >
        📍 View on Google Maps
      </a>
    </div>
  )
}
