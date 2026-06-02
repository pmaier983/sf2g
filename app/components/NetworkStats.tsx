/**
 * NetworkStats — Graph statistics cards displayed below the network graph.
 *
 * Shows interesting graph/tree-based metrics in a responsive card grid.
 */
import type { NetworkStats as NetworkStatsType } from '../server/network'
import { Link } from '@tanstack/react-router'

interface NetworkStatsProps {
  stats: NetworkStatsType
}

export function NetworkStats({ stats }: NetworkStatsProps) {
  return (
    <section className="network-stats">
      <h2 className="network-stats__title">Network Statistics</h2>
      <div className="network-stats__grid">
        <div className="network-stats__card">
          <span className="network-stats__card-icon">🔗</span>
          <span className="network-stats__card-value">
            {stats.totalConnections}
          </span>
          <span className="network-stats__card-label">
            Total Connections
          </span>
        </div>

        <div className="network-stats__card">
          <span className="network-stats__card-icon">👥</span>
          <span className="network-stats__card-value">
            {stats.totalRiders}
          </span>
          <span className="network-stats__card-label">
            Total Riders
          </span>
        </div>

        <div className="network-stats__card">
          <span className="network-stats__card-icon">📊</span>
          <span className="network-stats__card-value">
            {stats.avgConnectionsPerRider}
          </span>
          <span className="network-stats__card-label">
            Avg Connections / Rider
          </span>
        </div>

        {stats.mostConnectedRider && (
          <div className="network-stats__card network-stats__card--highlight">
            <span className="network-stats__card-icon">🌟</span>
            <span className="network-stats__card-value">
              <Link
                to="/profile/$userId"
                params={{ userId: stats.mostConnectedRider.id }}
                className="network-stats__link"
              >
                {stats.mostConnectedRider.name}
              </Link>
            </span>
            <span className="network-stats__card-label">
              Most Connected ({stats.mostConnectedRider.connections})
            </span>
          </div>
        )}

        {stats.strongestBond && (
          <div className="network-stats__card network-stats__card--highlight">
            <span className="network-stats__card-icon">💪</span>
            <span className="network-stats__card-value network-stats__card-value--bond">
              <Link
                to="/profile/$userId"
                params={{ userId: stats.strongestBond.rider1Id }}
                className="network-stats__link"
              >
                {stats.strongestBond.rider1}
              </Link>
              {' ↔ '}
              <Link
                to="/profile/$userId"
                params={{ userId: stats.strongestBond.rider2Id }}
                className="network-stats__link"
              >
                {stats.strongestBond.rider2}
              </Link>
            </span>
            <span className="network-stats__card-label">
              Strongest Bond ({stats.strongestBond.rides} rides)
            </span>
          </div>
        )}

        <div className="network-stats__card">
          <span className="network-stats__card-icon">🏘️</span>
          <span className="network-stats__card-value">
            {stats.communities}
          </span>
          <span className="network-stats__card-label">
            Riding Communities
          </span>
        </div>

        <div className="network-stats__card">
          <span className="network-stats__card-icon">🕸️</span>
          <span className="network-stats__card-value">
            {(stats.networkDensity * 100).toFixed(1)}%
          </span>
          <span className="network-stats__card-label">
            Network Density
          </span>
        </div>

        <div className="network-stats__card">
          <span className="network-stats__card-icon">🏝️</span>
          <span className="network-stats__card-value">
            {stats.isolatedRiders}
          </span>
          <span className="network-stats__card-label">
            Solo Riders
          </span>
        </div>
      </div>
    </section>
  )
}
