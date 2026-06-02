/**
 * NetworkGraph — Interactive force-directed graph visualization.
 *
 * Renders an interactive 2D force-directed network graph using
 * react-force-graph-2d (canvas-based for performance).
 *
 * Features:
 * - Node sizing proportional to total SF2G rides
 * - Node coloring by primary route category
 * - Edge thickness proportional to co-ride count (log scale)
 * - Hover highlights connected nodes + tooltip
 * - Click selects a node (triggers onNodeSelect callback)
 * - Current user node has a golden glow
 * - Built-in zoom/pan
 */
import {
  useRef,
  useCallback,
  useState,
  useMemo,
  useEffect,
} from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type {
  NetworkNode,
  NetworkEdge,
} from '../server/network'
import { ROUTE_COLORS } from '../lib/constants'
import type { RouteCategory } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetworkGraphProps {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  currentUserId?: string | null
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string | null) => void
}

interface ForceGraphNode {
  id: string
  name: string
  avatar: string | null
  totalRides: number
  primaryRoute: RouteCategory
  connectionCount: number
  x?: number
  y?: number
}

interface ForceGraphLink {
  source: string | ForceGraphNode
  target: string | ForceGraphNode
  weight: number
  dominantRoute: RouteCategory
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeRadius(totalRides: number): number {
  // Min 3, max 10, log scale — kept small to avoid overlap
  return Math.max(3, Math.min(10, 3 + Math.log2(totalRides + 1) * 1.2))
}

function getEdgeWidth(weight: number): number {
  // Min 0.3, max 4, log scale
  return Math.max(0.3, Math.min(4, 0.3 + Math.log2(weight + 1) * 1.2))
}

function getDominantRoute(
  routes: Partial<Record<RouteCategory, number>>,
): RouteCategory {
  let best: RouteCategory = 'other'
  let maxCount = 0
  for (const [route, count] of Object.entries(routes)) {
    if ((count ?? 0) > maxCount) {
      maxCount = count ?? 0
      best = route as RouteCategory
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NetworkGraph({
  nodes,
  edges,
  currentUserId,
  selectedNodeId,
  onNodeSelect,
}: NetworkGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 550 })

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(400, Math.min(600, entry.contentRect.height)),
        })
      }
    })

    observer.observe(el)
    // Set initial dimensions
    setDimensions({
      width: el.clientWidth,
      height: Math.max(400, Math.min(600, el.clientHeight || 550)),
    })

    return () => observer.disconnect()
  }, [])

  // Transform data for force-graph
  const graphData = useMemo(() => {
    const graphNodes: ForceGraphNode[] = nodes.map((n) => ({
      id: n.id,
      name: n.name,
      avatar: n.avatar,
      totalRides: n.totalRides,
      primaryRoute: n.primaryRoute,
      connectionCount: n.connectionCount,
    }))

    const graphLinks: ForceGraphLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      dominantRoute: getDominantRoute(e.routes),
    }))

    return { nodes: graphNodes, links: graphLinks }
  }, [nodes, edges])

  // Configure d3-force for better spacing
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return

    // Increase repulsion to push nodes apart
    const charge = fg.d3Force('charge')
    if (charge && typeof charge.strength === 'function') {
      charge.strength(-150)
      charge.distanceMax(400)
    }

    // Increase link distance so connected nodes aren't too close
    const link = fg.d3Force('link')
    if (link && typeof link.distance === 'function') {
      link.distance(80)
    }

    // Reheat simulation to apply new forces
    fg.d3ReheatSimulation?.()
  }, [graphData])

  // Set of connected node IDs for the hovered node
  const highlightedNodes = useMemo(() => {
    const set = new Set<string>()
    if (!hoveredNode && !selectedNodeId) return set

    const activeId = hoveredNode ?? selectedNodeId
    if (!activeId) return set

    set.add(activeId)
    for (const edge of edges) {
      if (edge.source === activeId) set.add(edge.target)
      if (edge.target === activeId) set.add(edge.source)
    }
    return set
  }, [hoveredNode, selectedNodeId, edges])

  const hasHighlight = highlightedNodes.size > 0

  // Node renderer (canvas)
  const paintNode = useCallback(
    (
      node: ForceGraphNode,
      ctx: CanvasRenderingContext2D,
    ) => {
      const x = node.x ?? 0
      const y = node.y ?? 0
      const radius = getNodeRadius(node.totalRides)
      const isHighlighted = highlightedNodes.has(node.id)
      const isDimmed = hasHighlight && !isHighlighted
      const isCurrentUser = node.id === currentUserId
      const isSelected = node.id === selectedNodeId

      // Glow for current user
      if (isCurrentUser || isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI)
        ctx.fillStyle = isCurrentUser
          ? 'rgba(255, 102, 0, 0.3)'
          : 'rgba(99, 102, 241, 0.3)'
        ctx.fill()
      }

      // Main circle
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      const color =
        ROUTE_COLORS[node.primaryRoute] ?? ROUTE_COLORS.other
      ctx.fillStyle = isDimmed ? `${color}44` : color
      ctx.fill()

      // Border
      ctx.strokeStyle = isDimmed
        ? 'rgba(255,255,255,0.1)'
        : isCurrentUser
          ? '#FF6600'
          : 'rgba(255,255,255,0.6)'
      ctx.lineWidth = isCurrentUser || isSelected ? 2 : 1
      ctx.stroke()

      // Label (only for highlighted or hovered nodes)
      if (isHighlighted) {
        ctx.font = `${isDimmed ? '7' : '9'}px Open Sans, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = isDimmed
          ? 'rgba(255,255,255,0.3)'
          : 'rgba(255,255,255,0.9)'
        ctx.fillText(node.name, x, y + radius + 3)
      }
    },
    [highlightedNodes, hasHighlight, currentUserId, selectedNodeId],
  )

  // Link renderer
  const paintLink = useCallback(
    (
      link: ForceGraphLink,
      ctx: CanvasRenderingContext2D,
    ) => {
      const source = link.source as ForceGraphNode
      const target = link.target as ForceGraphNode
      if (!source.x || !source.y || !target.x || !target.y) return

      const sourceHighlighted = highlightedNodes.has(
        typeof source === 'string' ? source : source.id,
      )
      const targetHighlighted = highlightedNodes.has(
        typeof target === 'string' ? target : target.id,
      )
      const isHighlighted = sourceHighlighted && targetHighlighted
      const isDimmed = hasHighlight && !isHighlighted

      const color =
        ROUTE_COLORS[link.dominantRoute] ?? ROUTE_COLORS.other
      ctx.strokeStyle = isDimmed ? `${color}15` : `${color}88`
      ctx.lineWidth = isDimmed
        ? 0.3
        : getEdgeWidth(link.weight)
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(target.x, target.y)
      ctx.stroke()
    },
    [highlightedNodes, hasHighlight],
  )

  const handleNodeHover = useCallback(
    (node: ForceGraphNode | null) => {
      setHoveredNode(node?.id ?? null)
      if (containerRef.current) {
        containerRef.current.style.cursor = node ? 'pointer' : 'default'
      }
    },
    [],
  )

  const handleNodeClick = useCallback(
    (node: ForceGraphNode) => {
      onNodeSelect(node.id === selectedNodeId ? null : node.id)
    },
    [onNodeSelect, selectedNodeId],
  )

  const handleBgClick = useCallback(() => {
    onNodeSelect(null)
  }, [onNodeSelect])

  // Tooltip for hovered node
  const hoveredNodeData = useMemo(
    () => nodes.find((n) => n.id === hoveredNode),
    [nodes, hoveredNode],
  )

  return (
    <div className="network-graph" ref={containerRef}>
      <ForceGraph2D
        ref={graphRef as never}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={paintNode as never}
        linkCanvasObject={paintLink as never}
        onNodeHover={handleNodeHover as never}
        onNodeClick={handleNodeClick as never}
        onBackgroundClick={handleBgClick}
        nodeLabel=""
        linkLabel=""
        cooldownTicks={200}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
        warmupTicks={50}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        minZoom={0.5}
        maxZoom={8}
        backgroundColor="transparent"
      />
      {hoveredNodeData && (
        <div className="network-graph__tooltip">
          <span className="network-graph__tooltip-name">
            {hoveredNodeData.name}
          </span>
          <span className="network-graph__tooltip-detail">
            {hoveredNodeData.totalRides} rides ·{' '}
            {hoveredNodeData.connectionCount} connections
          </span>
        </div>
      )}
    </div>
  )
}
