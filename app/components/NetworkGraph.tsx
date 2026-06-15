/**
 * NetworkGraph — Interactive force-directed graph visualization.
 *
 * Renders an interactive 2D force-directed network graph using
 * react-force-graph-2d (canvas-based for performance).
 *
 * Features:
 * - Node sizing proportional to total SF2G rides
 * - Node coloring by primary route category
 * - Profile picture rendering with circular clip and route-colored border
 * - Edge thickness proportional to co-ride count
 * - Hover highlights connected nodes + tooltip
 * - Click selects a node (triggers onNodeSelect callback)
 * - Current user node has a pulsing golden glow
 * - Labels shown on hover/select only to prevent clutter
 * - Built-in zoom/pan with auto-fit on load
 */
import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import ForceGraph2D from "react-force-graph-2d";
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

interface ForceGraphNode {
  id: string;
  name: string;
  avatar: string | null;
  totalRides: number;
  primaryRoute: RouteCategory;
  connectionCount: number;
  val: number;
  x?: number;
  y?: number;
}

interface ForceGraphLink {
  source: string | ForceGraphNode;
  target: string | ForceGraphNode;
  weight: number;
  dominantRoute: RouteCategory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENT_USER_SIZE_MULTIPLIER = 1.3;

/** Maximum characters for a name label before truncation */
const MAX_NAME_LENGTH = 10;

function getNodeRadius(totalRides: number): number {
  // Min 4, max 8 — visible at default zoom
  return Math.max(4, Math.min(8, 4 + Math.log2(totalRides + 1) * 0.8));
}

/** Convert hex color (#RRGGBB) to rgba string — canvas doesn't reliably
 *  support 8-digit hex (#RRGGBBAA), so we convert explicitly. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

/** Truncate a name to maxLen characters, appending ellipsis if needed */
function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + "\u2026";
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
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 550 });
  const animFrameRef = useRef<number>(0);
  const hasZoomedRef = useRef(false);

  // -----------------------------------------------------------------------
  // Profile picture image cache
  // -----------------------------------------------------------------------
  const imageCacheRef = useRef(new Map<string, HTMLImageElement | null>());
  const [, setImageLoadCount] = useState(0);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.avatar && !imageCacheRef.current.has(node.id)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = node.avatar;
        img.onload = () => {
          imageCacheRef.current.set(node.id, img);
          setImageLoadCount((c) => c + 1);
        };
        img.onerror = () => {
          imageCacheRef.current.set(node.id, null);
        };
      }
    });
  }, [nodes]);

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
      width: el.clientWidth,
      height: Math.max(400, Math.min(700, el.clientHeight || 550)),
    });

    return () => observer.disconnect();
  }, []);

  // Animation loop for pulsing glow on current user node.
  useEffect(() => {
    if (!currentUserId) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      const fg = graphRef.current;
      if (fg) {
        fg.renderer?.();
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentUserId]);

  // -----------------------------------------------------------------------
  // Build graph data — ONLY include connected nodes (removes isolates that
  // scatter far away and break zoom-to-fit)
  // -----------------------------------------------------------------------
  const graphData = useMemo(() => {
    // Find all node IDs that appear in at least one edge
    const connectedIds = new Set<string>();
    for (const e of edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }

    const graphNodes: ForceGraphNode[] = nodes
      .filter((n) => connectedIds.has(n.id))
      .map((n) => ({
        id: n.id,
        name: n.name,
        avatar: n.avatar,
        totalRides: n.totalRides,
        primaryRoute: n.primaryRoute,
        connectionCount: n.connectionCount,
        // val controls node area in the force simulation
        val: Math.max(1, n.connectionCount),
      }));

    const graphLinks: ForceGraphLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      dominantRoute: getDominantRoute(e.routes),
    }));

    return { nodes: graphNodes, links: graphLinks };
  }, [nodes, edges]);

  // Configure d3-force
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    hasZoomedRef.current = false;

    // Moderate repulsion — enough spacing without blowing the graph apart
    const charge = fg.d3Force("charge");
    if (charge && typeof charge.strength === "function") {
      charge.strength(-200);
      charge.distanceMax(400);
    }

    // Link distance proportional to weight — strong bonds pull closer
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") {
      link.distance((l: ForceGraphLink) => {
        const w = typeof l.weight === "number" ? l.weight : 5;
        // Stronger connections → shorter distance (40-100 range)
        return Math.max(40, 100 - Math.log2(w + 1) * 15);
      });
    }

    fg.d3ReheatSimulation?.();
  }, [graphData]);

  // After simulation cools, zoom to fit (only once per data load)
  const handleEngineStop = useCallback(() => {
    if (hasZoomedRef.current) return;
    hasZoomedRef.current = true;
    const fg = graphRef.current;
    if (fg) {
      fg.zoomToFit(400, 60);
    }
  }, []);

  // Set of connected node IDs for the hovered node
  const highlightedNodes = useMemo(() => {
    const set = new Set<string>();
    if (!hoveredNode && !selectedNodeId) return set;

    const activeId = hoveredNode ?? selectedNodeId;
    if (!activeId) return set;

    set.add(activeId);
    for (const edge of edges) {
      if (edge.source === activeId) set.add(edge.target);
      if (edge.target === activeId) set.add(edge.source);
    }
    return set;
  }, [hoveredNode, selectedNodeId, edges]);

  const hasHighlight = highlightedNodes.size > 0;

  // -----------------------------------------------------------------------
  // Node renderer (canvas)
  // -----------------------------------------------------------------------
  const paintNode = useCallback(
    (node: ForceGraphNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const baseRadius = getNodeRadius(node.totalRides);
      const isHighlighted = highlightedNodes.has(node.id);
      const isCurrentUser = node.id === currentUserId;
      const isSelected = node.id === selectedNodeId;
      const isDimmed = hasHighlight && !isHighlighted && !isCurrentUser;

      const cachedImg = imageCacheRef.current.get(node.id);
      const hasImage = cachedImg != null;

      let radius = baseRadius;
      if (isCurrentUser) {
        radius *= CURRENT_USER_SIZE_MULTIPLIER;
      }

      const color = ROUTE_COLORS[node.primaryRoute] ?? ROUTE_COLORS.other;
      const borderWidth = isCurrentUser || isSelected || isHighlighted ? 2 : 1;

      // Pulsing glow for current user
      if (isCurrentUser) {
        const t = Date.now() / 1000;
        const pulseAlpha = 0.3 + 0.15 * Math.sin(t * 2.5);
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 102, 0, ${pulseAlpha.toFixed(3)})`;
        ctx.fill();
      } else if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
        ctx.fill();
      }

      // --- Draw the node body ---
      if (hasImage) {
        ctx.save();
        if (isDimmed) ctx.globalAlpha = 0.35;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(
          cachedImg,
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );
        ctx.restore();

        // Route-colored border ring
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = isDimmed ? hexToRgba(color, 0.3) : color;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      } else {
        // Fallback: colored circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isDimmed ? hexToRgba(color, 0.2) : color;
        ctx.fill();
        ctx.strokeStyle = isDimmed
          ? "rgba(255,255,255,0.1)"
          : isCurrentUser
            ? "#FF6600"
            : "rgba(255,255,255,0.6)";
        ctx.lineWidth = isCurrentUser || isSelected ? 2 : 1;
        ctx.stroke();
      }

      // --- "You" tag above current user ---
      if (isCurrentUser) {
        const tagFontSize = 5;
        ctx.font = `bold ${tagFontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const tagText = "You";
        const tagWidth = ctx.measureText(tagText).width;
        const tagPadX = 2;
        const tagPadY = 1;
        const tagY = y - radius - 3;

        ctx.fillStyle = "rgba(255, 102, 0, 0.9)";
        const rr = 2;
        const rx = x - tagWidth / 2 - tagPadX;
        const ry = tagY - tagFontSize - tagPadY;
        const rw = tagWidth + tagPadX * 2;
        const rh = tagFontSize + tagPadY * 2;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, rr);
        ctx.fill();

        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(tagText, x, tagY);
      }

      // --- Name label: only on hover, select, or current user ---
      const showLabel = isHighlighted || isCurrentUser || isSelected;
      if (showLabel) {
        const fontSize = 4;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const displayName = truncateName(node.name, MAX_NAME_LENGTH);
        const textWidth = ctx.measureText(displayName).width;
        const padX = 2;
        const padY = 1;
        const labelY = y + radius + 2;

        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(
          x - textWidth / 2 - padX,
          labelY,
          textWidth + padX * 2,
          fontSize + padY * 2,
        );

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.fillText(displayName, x, labelY + padY);
      }
    },
    [highlightedNodes, hasHighlight, currentUserId, selectedNodeId],
  );

  // -----------------------------------------------------------------------
  // Link color + width via built-in props (more reliable than custom paint)
  // -----------------------------------------------------------------------
  const getLinkColor = useCallback(
    (link: ForceGraphLink) => {
      const sourceId =
        typeof link.source === "string" ? link.source : link.source.id;
      const targetId =
        typeof link.target === "string" ? link.target : link.target.id;
      const color = ROUTE_COLORS[link.dominantRoute] ?? ROUTE_COLORS.other;

      if (hasHighlight) {
        const bothHighlighted =
          highlightedNodes.has(sourceId) && highlightedNodes.has(targetId);
        return bothHighlighted ? hexToRgba(color, 0.9) : hexToRgba(color, 0.05);
      }
      return hexToRgba(color, 0.6);
    },
    [highlightedNodes, hasHighlight],
  );

  const getLinkWidth = useCallback(
    (link: ForceGraphLink) => {
      const sourceId =
        typeof link.source === "string" ? link.source : link.source.id;
      const targetId =
        typeof link.target === "string" ? link.target : link.target.id;

      if (hasHighlight) {
        const bothHighlighted =
          highlightedNodes.has(sourceId) && highlightedNodes.has(targetId);
        return bothHighlighted
          ? Math.max(2, Math.min(5, 2 + Math.log2(link.weight + 1)))
          : 0.3;
      }
      return Math.max(1, Math.min(4, 1 + Math.log2(link.weight + 1) * 0.8));
    },
    [highlightedNodes, hasHighlight],
  );

  const handleNodeHover = useCallback((node: ForceGraphNode | null) => {
    setHoveredNode(node?.id ?? null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  const handleNodeClick = useCallback(
    (node: ForceGraphNode) => {
      onNodeSelect(node.id === selectedNodeId ? null : node.id);
    },
    [onNodeSelect, selectedNodeId],
  );

  const handleBgClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  // Tooltip for hovered node
  const hoveredNodeData = useMemo(
    () => nodes.find((n) => n.id === hoveredNode),
    [nodes, hoveredNode],
  );

  return (
    <div className="network-graph" ref={containerRef}>
      <ForceGraph2D
        ref={graphRef as never}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeCanvasObject={paintNode as never}
        nodePointerAreaPaint={
          ((
            node: ForceGraphNode,
            color: string,
            ctx: CanvasRenderingContext2D,
          ) => {
            const r = getNodeRadius(node.totalRides);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, r + 2, 0, 2 * Math.PI);
            ctx.fill();
          }) as never
        }
        linkColor={getLinkColor as never}
        linkWidth={getLinkWidth as never}
        onNodeHover={handleNodeHover as never}
        onNodeClick={handleNodeClick as never}
        onBackgroundClick={handleBgClick}
        onEngineStop={handleEngineStop}
        nodeLabel=""
        linkLabel=""
        cooldownTicks={150}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        warmupTicks={100}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        minZoom={0.8}
        maxZoom={10}
        backgroundColor="transparent"
      />
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
