/**
 * NetworkGraph — SVG-based force-directed network visualization.
 *
 * REBUILT FROM SCRATCH using pure SVG + a simple force simulation.
 * No react-force-graph-2d — that library divides link widths by zoom
 * level in its canvas renderer, making edges invisible.
 *
 * This approach uses SVG <line> elements for edges and <circle>/<image>
 * for nodes. SVG guarantees visibility because elements are actual DOM
 * nodes with real CSS-like stroke widths.
 */
import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import type { NetworkNode, NetworkEdge } from "../server/network";
import { ROUTE_COLORS } from "../lib/constants";
import type { RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetworkGraphProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  currentUserId?: string | null;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
}

interface SimNode {
  id: string;
  name: string;
  avatar: string | null;
  totalRides: number;
  primaryRoute: RouteCategory;
  connectionCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  sourceId: string;
  targetId: string;
  weight: number;
  dominantRoute: RouteCategory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDominantRoute(
  routes: Partial<Record<RouteCategory, number>>,
): RouteCategory {
  let best: RouteCategory = "other";
  let maxCount = 0;
  for (const [route, count] of Object.entries(routes)) {
    if ((count ?? 0) > maxCount) {
      maxCount = count ?? 0;
      best = route as RouteCategory;
    }
  }
  return best;
}

function getNodeRadius(totalRides: number): number {
  return Math.max(16, Math.min(32, 16 + Math.log2(totalRides + 1) * 4));
}

function getEdgeWidth(weight: number): number {
  return Math.max(2, Math.min(8, 2 + Math.log2(weight + 1) * 2));
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Simple Force Simulation (no d3 dependency)
// ---------------------------------------------------------------------------

function runForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  iterations: number = 300,
): void {
  const nodeMap = new Map<string, SimNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Initialize positions in a circle
  const cx = width / 2;
  const cy = height / 2;
  const initRadius = Math.min(width, height) * 0.35;
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    n.x = cx + initRadius * Math.cos(angle);
    n.y = cy + initRadius * Math.sin(angle);
    n.vx = 0;
    n.vy = 0;
  });

  // Pre-compute radii for collision detection
  const radii = new Map<string, number>();
  for (const n of nodes) {
    radii.set(n.id, getNodeRadius(n.totalRides));
  }

  const repulsionStrength = 15000;
  const attractionStrength = 0.003;
  const centerStrength = 0.008;
  const damping = 0.9;
  const collisionPadding = 28; // accounts for name labels below nodes (4px gap + 18px label + margin)

  for (let iter = 0; iter < iterations; iter++) {
    // 1. Repulsive forces between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;

        const force = repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 2. Attractive forces along edges (stronger for higher weight)
    for (const edge of edges) {
      const source = nodeMap.get(edge.sourceId);
      const target = nodeMap.get(edge.targetId);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      const strength =
        attractionStrength * (1 + Math.log2(edge.weight + 1) * 0.5);
      const force = dist * strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // 3. Center gravity
    for (const n of nodes) {
      n.vx += (cx - n.x) * centerStrength;
      n.vy += (cy - n.y) * centerStrength;
    }

    // 4. Apply velocities with damping
    const tempDamping = damping - (iter / iterations) * 0.3;
    for (const n of nodes) {
      n.vx *= tempDamping;
      n.vy *= tempDamping;
      n.x += n.vx;
      n.y += n.vy;
    }

    // 5. COLLISION RESOLUTION — hard constraint, prevents overlap
    //    Pushes any overlapping pair apart based on their actual radii.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) dist = 0.1;

        const rA = radii.get(a.id) ?? 16;
        const rB = radii.get(b.id) ?? 16;
        const minDist = rA + rB + collisionPadding;

        if (dist < minDist) {
          // Push apart so they don't overlap
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }

    // 6. Keep in bounds with padding
    for (const n of nodes) {
      const r = radii.get(n.id) ?? 16;
      const pad = r + 10;
      n.x = Math.max(pad, Math.min(width - pad, n.x));
      n.y = Math.max(pad, Math.min(height - pad, n.y));
    }
  }
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
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 550 });

  // Pan & Zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Node drag state
  const draggingNodeRef = useRef<string | null>(null);
  const didDragRef = useRef(false);

  // Mutable node positions (updated during drag)
  const [nodePositions, setNodePositions] = useState<
    Map<string, { x: number; y: number }>
  >(new Map());

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(400, Math.min(700, entry.contentRect.height)),
        });
      }
    });

    observer.observe(el);
    setDimensions({
      width: el.clientWidth || 800,
      height: Math.max(400, Math.min(700, el.clientHeight || 550)),
    });

    return () => observer.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Compute layout
  // -----------------------------------------------------------------------
  const { simNodes, simEdges } = useMemo(() => {
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }

    // Split into connected and solo riders
    const connectedNodes: SimNode[] = [];
    const soloNodes: SimNode[] = [];

    for (const n of nodes) {
      const simNode: SimNode = {
        id: n.id,
        name: n.name,
        avatar: n.avatar,
        totalRides: n.totalRides,
        primaryRoute: n.primaryRoute,
        connectionCount: n.connectionCount,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      };
      if (connectedIds.has(n.id)) {
        connectedNodes.push(simNode);
      } else {
        soloNodes.push(simNode);
      }
    }

    const simEdges: SimEdge[] = edges.map((e) => ({
      sourceId: e.source,
      targetId: e.target,
      weight: e.weight,
      dominantRoute: getDominantRoute(e.routes),
    }));

    // Run force simulation only on connected nodes
    runForceSimulation(
      connectedNodes,
      simEdges,
      dimensions.width,
      dimensions.height,
    );

    // Position solo riders in a ring around the outer edge
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const outerRadius = Math.min(dimensions.width, dimensions.height) * 0.46;
    soloNodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, soloNodes.length);
      n.x = cx + outerRadius * Math.cos(angle);
      n.y = cy + outerRadius * Math.sin(angle);
    });

    // Combine: connected first, then solo
    const simNodes = [...connectedNodes, ...soloNodes];

    return { simNodes, simEdges };
  }, [nodes, edges, dimensions.width, dimensions.height]);

  // Initialize node positions after simulation
  useEffect(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const n of simNodes) {
      positions.set(n.id, { x: n.x, y: n.y });
    }
    setNodePositions(positions);
  }, [simNodes]);

  // Build lookup map using current positions
  const nodeMap = useMemo(() => {
    const map = new Map<string, SimNode & { x: number; y: number }>();
    for (const n of simNodes) {
      const pos = nodePositions.get(n.id);
      map.set(n.id, { ...n, x: pos?.x ?? n.x, y: pos?.y ?? n.y });
    }
    return map;
  }, [simNodes, nodePositions]);

  // Highlighted nodes/edges
  const activeId = hoveredNode ?? selectedNodeId;
  const highlightedNodes = useMemo(() => {
    const set = new Set<string>();
    if (!activeId) return set;
    set.add(activeId);
    for (const edge of simEdges) {
      if (edge.sourceId === activeId) set.add(edge.targetId);
      if (edge.targetId === activeId) set.add(edge.sourceId);
    }
    return set;
  }, [activeId, simEdges]);

  const highlightedEdges = useMemo(() => {
    const set = new Set<string>();
    if (!activeId) return set;
    for (const edge of simEdges) {
      if (edge.sourceId === activeId || edge.targetId === activeId) {
        set.add(`${edge.sourceId}::${edge.targetId}`);
      }
    }
    return set;
  }, [activeId, simEdges]);

  const hasHighlight = highlightedNodes.size > 0;

  // -----------------------------------------------------------------------
  // Mouse handlers for pan, zoom, and node drag
  // -----------------------------------------------------------------------

  /** Convert screen coords to SVG graph coords */
  const screenToGraph = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  // Zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.3, Math.min(5, zoom * factor));

      // Zoom toward mouse position
      setPan((prev) => ({
        x: mouseX - (mouseX - prev.x) * (newZoom / zoom),
        y: mouseY - (mouseY - prev.y) * (newZoom / zoom),
      }));
      setZoom(newZoom);
    },
    [zoom],
  );

  // Start pan or node drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      // Check if we're clicking on a node
      const target = e.target as SVGElement;
      const nodeGroup = target.closest("[data-node-id]");

      if (nodeGroup) {
        // Start node drag
        const nodeId = nodeGroup.getAttribute("data-node-id")!;
        draggingNodeRef.current = nodeId;
        didDragRef.current = false;
      } else {
        // Start pan
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }

      e.preventDefault();
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
      } else if (draggingNodeRef.current) {
        didDragRef.current = true;
        const graphPos = screenToGraph(e.clientX, e.clientY);
        setNodePositions((prev) => {
          const next = new Map(prev);
          next.set(draggingNodeRef.current!, { x: graphPos.x, y: graphPos.y });
          return next;
        });
      }
    },
    [screenToGraph],
  );

  const handleMouseUp = useCallback(() => {
    if (draggingNodeRef.current && !didDragRef.current) {
      // It was a click, not a drag — handle as node click
      const nodeId = draggingNodeRef.current;
      onNodeSelect(nodeId === selectedNodeId ? null : nodeId);
    }
    isPanningRef.current = false;
    draggingNodeRef.current = null;
  }, [onNodeSelect, selectedNodeId]);

  const handleBgClick = useCallback(
    (e: React.MouseEvent) => {
      // Only deselect if clicking on the SVG background directly
      const target = e.target as SVGElement;
      if (target.closest("[data-node-id]")) return;
      if (isPanningRef.current) return;
      onNodeSelect(null);
      setHoveredNode(null);
    },
    [onNodeSelect],
  );

  const hoveredNodeData = useMemo(
    () => simNodes.find((n) => n.id === hoveredNode),
    [simNodes, hoveredNode],
  );

  return (
    <div className="network-graph" ref={containerRef}>
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleBgClick}
        style={{
          display: "block",
          cursor: isPanningRef.current ? "grabbing" : "grab",
        }}
      >
        {/* Single transform group for pan + zoom */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* ---------- EDGES ---------- */}
          <g className="network-graph__edges">
            {simEdges.map((edge) => {
              const source = nodeMap.get(edge.sourceId);
              const target = nodeMap.get(edge.targetId);
              if (!source || !target) return null;

              const edgeKey = `${edge.sourceId}::${edge.targetId}`;
              const isEdgeHighlighted = highlightedEdges.has(edgeKey);
              const isDimmed = hasHighlight && !isEdgeHighlighted;
              const color =
                ROUTE_COLORS[edge.dominantRoute] ?? ROUTE_COLORS.other;

              return (
                <line
                  key={edgeKey}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isDimmed ? hexToRgba(color, 0.1) : color}
                  strokeWidth={isDimmed ? 1 : getEdgeWidth(edge.weight)}
                  strokeOpacity={isDimmed ? 0.3 : 0.8}
                  strokeLinecap="round"
                />
              );
            })}
          </g>

          {/* ---------- NODES ---------- */}
          <g className="network-graph__nodes">
            {simNodes.map((node) => {
              const pos = nodePositions.get(node.id);
              const x = pos?.x ?? node.x;
              const y = pos?.y ?? node.y;
              const radius = getNodeRadius(node.totalRides);
              const isHighlighted = highlightedNodes.has(node.id);
              const isCurrentUser = node.id === currentUserId;
              const isSelected = node.id === selectedNodeId;
              const isSolo = node.connectionCount === 0;
              const isDimmed =
                (hasHighlight && !isHighlighted && !isCurrentUser) ||
                (isSolo && !isHighlighted && !isSelected);
              const color =
                ROUTE_COLORS[node.primaryRoute] ?? ROUTE_COLORS.other;
              const showLabel = isHighlighted || isCurrentUser || isSelected;
              const baseRadius = isCurrentUser
                ? radius * 1.2
                : isSolo
                  ? radius * 0.7
                  : radius;
              const finalRadius = baseRadius;

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  transform={`translate(${x}, ${y})`}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    cursor:
                      draggingNodeRef.current === node.id
                        ? "grabbing"
                        : "pointer",
                  }}
                  opacity={isDimmed ? (isSolo ? 0.5 : 0.3) : 1}
                >
                  {/* Glow ring for current user */}
                  {isCurrentUser && (
                    <circle
                      r={finalRadius + 6}
                      fill="none"
                      stroke="#FF6600"
                      strokeWidth={3}
                      strokeOpacity={0.5}
                    >
                      <animate
                        attributeName="stroke-opacity"
                        values="0.3;0.7;0.3"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}

                  {/* Selection ring */}
                  {isSelected && !isCurrentUser && (
                    <circle
                      r={finalRadius + 4}
                      fill="none"
                      stroke="#6366F1"
                      strokeWidth={2}
                      strokeOpacity={0.6}
                    />
                  )}

                  {/* Node circle (colored fallback) */}
                  <circle r={finalRadius} fill={color} />

                  {/* Profile picture */}
                  {node.avatar && (
                    <>
                      <clipPath id={`clip-${node.id}`}>
                        <circle r={finalRadius} />
                      </clipPath>
                      <image
                        href={node.avatar}
                        x={-finalRadius}
                        y={-finalRadius}
                        width={finalRadius * 2}
                        height={finalRadius * 2}
                        clipPath={`url(#clip-${node.id})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </>
                  )}

                  {/* Route-colored border ring */}
                  <circle
                    r={finalRadius}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHighlighted || isCurrentUser ? 3 : 2}
                  />

                  {/* "You" tag */}
                  {isCurrentUser && (
                    <>
                      <rect
                        x={-14}
                        y={-finalRadius - 20}
                        width={28}
                        height={16}
                        rx={4}
                        fill="rgba(255, 102, 0, 0.9)"
                      />
                      <text
                        y={-finalRadius - 9}
                        textAnchor="middle"
                        fill="white"
                        fontSize={10}
                        fontWeight="bold"
                        style={{ pointerEvents: "none" }}
                      >
                        You
                      </text>
                    </>
                  )}

                  {/* Name label (only on hover/select/currentUser) */}
                  {showLabel && (
                    <>
                      <rect
                        x={-40}
                        y={finalRadius + 4}
                        width={80}
                        height={18}
                        rx={4}
                        fill="rgba(0, 0, 0, 0.7)"
                      />
                      <text
                        y={finalRadius + 16}
                        textAnchor="middle"
                        fill="white"
                        fontSize={11}
                        style={{ pointerEvents: "none" }}
                      >
                        {node.name.length > 12
                          ? node.name.slice(0, 11) + "\u2026"
                          : node.name}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredNodeData && (
        <div className="network-graph__tooltip">
          <span className="network-graph__tooltip-name">
            {hoveredNodeData.name}
          </span>
          <span className="network-graph__tooltip-detail">
            {hoveredNodeData.totalRides} rides ·{" "}
            {hoveredNodeData.connectionCount} connections
          </span>
        </div>
      )}
    </div>
  );
}
