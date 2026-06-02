/**
 * NetworkSidebar — Detail panel for a selected rider in the network graph.
 *
 * Shows:
 * - Rider avatar + name (link to profile)
 * - Total connections + total co-rides
 * - Top 5 riding partners
 * - Route breakdown of shared rides
 * - Degrees of separation from current user (if logged in)
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import type { NetworkNode, NetworkEdge } from '../server/network'
import { shortestPath } from '../lib/graph-utils'
import { ROUTE_LABELS, ROUTE_COLORS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'

interface NetworkSidebarProps {
  selectedNodeId: string
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  currentUserId?: string | null
  onClose: () => void
}

export function NetworkSidebar({
  selectedNodeId,
  nodes,
  edges,
  currentUserId,
  onClose,
}: NetworkSidebarProps) {
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  )

  // Find all edges involving this node
  const nodeEdges = useMemo(
    () =>
      edges
        .filter(
          (e) => e.source === selectedNodeId || e.target === selectedNodeId,
        )
        .sort((a, b) => b.weight - a.weight),
    [edges, selectedNodeId],
  )

  // Top 5 riding partners
  const topPartners = useMemo(() => {
    return nodeEdges.slice(0, 5).map((edge) => {
      const partnerId =
        edge.source === selectedNodeId ? edge.target : edge.source
      const partner = nodes.find((n) => n.id === partnerId)
      return {
        id: partnerId,
        name: partner?.name ?? 'Unknown',
        avatar: partner?.avatar ?? null,
        rides: edge.weight,
        routes: edge.routes,
      }
    })
  }, [nodeEdges, nodes, selectedNodeId])

  // Total co-rides
  const totalCoRides = useMemo(
    () => nodeEdges.reduce((sum, e) => sum + e.weight, 0),
    [nodeEdges],
  )

  // Route breakdown across all connections
  const routeBreakdown = useMemo(() => {
    const counts: Partial<Record<RouteCategory, number>> = {}
    for (const edge of nodeEdges) {
      for (const [route, count] of Object.entries(edge.routes)) {
        const r = route as RouteCategory
        counts[r] = (counts[r] ?? 0) + (count ?? 0)
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      .map(([route, count]) => ({ route: route as RouteCategory, count: count ?? 0 }))
  }, [nodeEdges])

  // Degrees of separation from current user
  const degreesOfSeparation = useMemo(() => {
    if (!currentUserId || currentUserId === selectedNodeId) return null
    return shortestPath(edges, currentUserId, selectedNodeId)
  }, [edges, currentUserId, selectedNodeId])

  if (!selectedNode) return null

  return (
    <aside className="network-sidebar">
      <button
        className="network-sidebar__close"
        onClick={onClose}
        aria-label="Close sidebar"
      >
        ✕
      </button>

      {/* Rider header */}
      <div className="network-sidebar__header">
        {selectedNode.avatar ? (
          <img
            src={selectedNode.avatar}
            alt={selectedNode.name}
            className="network-sidebar__avatar"
          />
        ) : (
          <div className="network-sidebar__avatar network-sidebar__avatar--placeholder">
            👤
          </div>
        )}
        <div className="network-sidebar__info">
          <Link
            to="/profile/$userId"
            params={{ userId: selectedNode.id }}
            className="network-sidebar__name"
          >
            {selectedNode.name}
          </Link>
          <span className="network-sidebar__subtitle">
            {nodeEdges.length} connections · {totalCoRides} shared rides
          </span>
          {degreesOfSeparation !== null && (
            <span className="network-sidebar__degrees">
              {degreesOfSeparation === 0
                ? "That's you!"
                : `${degreesOfSeparation} degree${degreesOfSeparation !== 1 ? 's' : ''} of separation`}
            </span>
          )}
        </div>
      </div>

      {/* Top riding partners */}
      {topPartners.length > 0 && (
        <div className="network-sidebar__section">
          <h3 className="network-sidebar__section-title">
            Top Riding Partners
          </h3>
          <ul className="network-sidebar__partner-list">
            {topPartners.map((partner) => (
              <li key={partner.id} className="network-sidebar__partner">
                {partner.avatar ? (
                  <img
                    src={partner.avatar}
                    alt={partner.name}
                    className="network-sidebar__partner-avatar"
                  />
                ) : (
                  <div className="network-sidebar__partner-avatar network-sidebar__partner-avatar--placeholder">
                    👤
                  </div>
                )}
                <Link
                  to="/profile/$userId"
                  params={{ userId: partner.id }}
                  className="network-sidebar__partner-name"
                >
                  {partner.name}
                </Link>
                <span className="network-sidebar__partner-count">
                  {partner.rides} ride{partner.rides !== 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Route breakdown */}
      {routeBreakdown.length > 0 && (
        <div className="network-sidebar__section">
          <h3 className="network-sidebar__section-title">
            Shared Rides by Route
          </h3>
          <div className="network-sidebar__routes">
            {routeBreakdown.map(({ route, count }) => (
              <div key={route} className="network-sidebar__route-row">
                <span
                  className="network-sidebar__route-dot"
                  style={{
                    backgroundColor: ROUTE_COLORS[route] ?? ROUTE_COLORS.other,
                  }}
                />
                <span className="network-sidebar__route-label">
                  {ROUTE_LABELS[route] ?? route}
                </span>
                <span className="network-sidebar__route-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
