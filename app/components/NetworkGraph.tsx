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
 * - Edge thickness proportional to co-ride count (log scale)
 * - Hover highlights connected nodes + tooltip
 * - Click selects a node (triggers onNodeSelect callback)
 * - Current user node has a pulsing golden glow, 1.3× size, "You" tag
 * - Always-visible name labels with semi-transparent background
 * - Built-in zoom/pan
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

/** Size multiplier applied to the current user's node */
const CURRENT_USER_SIZE_MULTIPLIER = 1.2;

/** Maximum characters for a name label before truncation */
const MAX_NAME_LENGTH = 10;

function getNodeRadius(totalRides: number): number {
  // Min 4, max 8 — large enough to see profile pictures at default zoom
  return Math.max(4, Math.min(8, 4 + Math.log2(totalRides + 1) * 0.8));
}

function getEdgeWidth(weight: number): number {
  // Min 1.5, max 5 — thick enough to see connections clearly
  return Math.max(1.5, Math.min(5, 1.5 + Math.log2(weight + 1) * 1.0));
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

  // -----------------------------------------------------------------------
  // Profile picture image cache
  // null = load attempted but failed (avoids retrying broken URLs)
  // -----------------------------------------------------------------------
  const imageCacheRef = useRef(new Map<string, HTMLImageElement | null>());
  const [, setImageLoadCount] = useState(0);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.avatar && !imageCacheRef.current.has(node.id)) {
        const img = new Image();
        img.src = node.avatar;
        img.onload = () => {
          imageCacheRef.current.set(node.id, img);
          // Trigger re-render so paintNode picks up the loaded image
          setImageLoadCount((c) => c + 1);
        };
        img.onerror = () => {
          imageCacheRef.current.set(node.id, null); // Mark as failed
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
          height: Math.max(400, Math.min(600, entry.contentRect.height)),
        });
      }
    });

    observer.observe(el);
    // Set initial dimensions
    setDimensions({
      width: el.clientWidth,
      height: Math.max(400, Math.min(600, el.clientHeight || 550)),
    });

    return () => observer.disconnect();
  }, []);

  // Animation loop for pulsing glow on current user node.
  // Continuously requests re-renders so the time-based alpha in paintNode
  // produces a smooth pulsing effect.
  useEffect(() => {
    if (!currentUserId) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      // Trigger a canvas re-render by poking the graph's internal renderer
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

  // Transform data for force-graph
  const graphData = useMemo(() => {
    const graphNodes: ForceGraphNode[] = nodes.map((n) => ({
      id: n.id,
      name: n.name,
      avatar: n.avatar,
      totalRides: n.totalRides,
      primaryRoute: n.primaryRoute,
      connectionCount: n.connectionCount,
    }));

    const graphLinks: ForceGraphLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      dominantRoute: getDominantRoute(e.routes),
    }));

    return { nodes: graphNodes, links: graphLinks };
  }, [nodes, edges]);

  // Configure d3-force — keep the graph compact so auto-zoom doesn't
  // shrink everything to invisible dots
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    // Moderate repulsion — enough to separate nodes but keeps graph compact
    const charge = fg.d3Force("charge");
    if (charge && typeof charge.strength === "function") {
      charge.strength(-120);
      charge.distanceMax(300);
    }

    // Short link distance to keep connected nodes in a readable cluster
    const link = fg.d3Force("link");
    if (link && typeof link.distance === "function") {
      link.distance(60);
    }

    // Reheat simulation to apply new forces
    fg.d3ReheatSimulation?.();
  }, [graphData]);

  // After the simulation cools, zoom to fit all nodes with padding
  const handleEngineStop = useCallback(() => {
    const fg = graphRef.current;
    if (fg) {
      fg.zoomToFit(400, 40); // 400ms transition, 40px padding
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

  // Node renderer (canvas)
  const paintNode = useCallback(
    (node: ForceGraphNode, ctx: CanvasRenderingContext2D) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const baseRadius = getNodeRadius(node.totalRides);
      const isHighlighted = highlightedNodes.has(node.id);
      const isCurrentUser = node.id === currentUserId;
      const isSelected = node.id === selectedNodeId;

      // Current user is NEVER dimmed, even when hovering other nodes
      const isDimmed = hasHighlight && !isHighlighted && !isCurrentUser;

      // Check for cached profile picture image
      const cachedImg = imageCacheRef.current.get(node.id);
      const hasImage = cachedImg != null;

      // Apply size multiplier for current user
      let radius = baseRadius;
      if (isCurrentUser) {
        radius *= CURRENT_USER_SIZE_MULTIPLIER;
      }

      const color = ROUTE_COLORS[node.primaryRoute] ?? ROUTE_COLORS.other;
      const borderWidth = isCurrentUser || isSelected || isHighlighted ? 2 : 1;

      // Pulsing glow for current user (time-based alpha oscillation)
      if (isCurrentUser) {
        const t = Date.now() / 1000;
        // Oscillate alpha between 0.15 and 0.45
        const pulseAlpha = 0.3 + 0.15 * Math.sin(t * 2.5);
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 102, 0, ${pulseAlpha.toFixed(3)})`;
        ctx.fill();
      } else if (isSelected) {
        // Static glow for selected (non-current-user) node
        ctx.beginPath();
        ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
        ctx.fill();
      }

      // --- Draw the node body (PFP image or colored circle) ---
      if (hasImage) {
        // Render profile picture as a circular clipped image
        ctx.save();

        // Apply dimming via globalAlpha
        if (isDimmed) {
          ctx.globalAlpha = 0.4;
        }

        // Circular clip path
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.clip();

        // Draw the image scaled to fill the circle
        ctx.drawImage(
          cachedImg,
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );

        ctx.restore();

        // Route-colored border ring (drawn outside the clip)
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = isDimmed ? hexToRgba(color, 0.4) : color;
        ctx.lineWidth = borderWidth;
        ctx.stroke();
      } else {
        // Fallback: colored circle (original rendering)
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isDimmed ? hexToRgba(color, 0.25) : color;
        ctx.fill();

        // Border
        ctx.strokeStyle = isDimmed
          ? "rgba(255,255,255,0.1)"
          : isCurrentUser
            ? "#FF6600"
            : "rgba(255,255,255,0.6)";
        ctx.lineWidth = isCurrentUser || isSelected ? 2 : 1;
        ctx.stroke();
      }

      // --- "You" tag above the current user's node ---
      if (isCurrentUser) {
        const tagFontSize = 7;
        ctx.font = `${tagFontSize}px Open Sans, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const tagText = "You";
        const tagWidth = ctx.measureText(tagText).width;
        const tagPadX = 3;
        const tagPadY = 1;
        const tagY = y - radius - 5;

        // Tag background (orange pill)
        ctx.fillStyle = "rgba(255, 102, 0, 0.85)";
        const tagRectX = x - tagWidth / 2 - tagPadX;
        const tagRectY = tagY - tagFontSize - tagPadY;
        const tagRectW = tagWidth + tagPadX * 2;
        const tagRectH = tagFontSize + tagPadY * 2;

        // Draw rounded rect for pill shape
        const tagCorner = 3;
        ctx.beginPath();
        ctx.moveTo(tagRectX + tagCorner, tagRectY);
        ctx.lineTo(tagRectX + tagRectW - tagCorner, tagRectY);
        ctx.quadraticCurveTo(
          tagRectX + tagRectW,
          tagRectY,
          tagRectX + tagRectW,
          tagRectY + tagCorner,
        );
        ctx.lineTo(tagRectX + tagRectW, tagRectY + tagRectH - tagCorner);
        ctx.quadraticCurveTo(
          tagRectX + tagRectW,
          tagRectY + tagRectH,
          tagRectX + tagRectW - tagCorner,
          tagRectY + tagRectH,
        );
        ctx.lineTo(tagRectX + tagCorner, tagRectY + tagRectH);
        ctx.quadraticCurveTo(
          tagRectX,
          tagRectY + tagRectH,
          tagRectX,
          tagRectY + tagRectH - tagCorner,
        );
        ctx.lineTo(tagRectX, tagRectY + tagCorner);
        ctx.quadraticCurveTo(
          tagRectX,
          tagRectY,
          tagRectX + tagCorner,
          tagRectY,
        );
        ctx.closePath();
        ctx.fill();

        // Tag text
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(tagText, x, tagY);
      }

      // --- Name label: only show for hovered, selected, or current user ---
      const showLabel = isHighlighted || isCurrentUser || isSelected;
      if (showLabel) {
        const fontSize = isCurrentUser ? 5 : 4;
        ctx.font = `${fontSize}px Open Sans, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const displayName = truncateName(node.name, MAX_NAME_LENGTH);
        const textWidth = ctx.measureText(displayName).width;
        const labelPadX = 2;
        const labelPadY = 1;
        const labelY = y + radius + 2;

        // Semi-transparent background behind text for legibility
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(
          x - textWidth / 2 - labelPadX,
          labelY,
          textWidth + labelPadX * 2,
          fontSize + labelPadY * 2,
        );

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.fillText(displayName, x, labelY + labelPadY);
      }
    },
    [highlightedNodes, hasHighlight, currentUserId, selectedNodeId],
  );

  // Link renderer
  const paintLink = useCallback(
    (link: ForceGraphLink, ctx: CanvasRenderingContext2D) => {
      const source = link.source as ForceGraphNode;
      const target = link.target as ForceGraphNode;
      if (!source.x || !source.y || !target.x || !target.y) return;

      const sourceHighlighted = highlightedNodes.has(
        typeof source === "string" ? source : source.id,
      );
      const targetHighlighted = highlightedNodes.has(
        typeof target === "string" ? target : target.id,
      );
      const isHighlighted = sourceHighlighted && targetHighlighted;
      const isDimmed = hasHighlight && !isHighlighted;

      const color = ROUTE_COLORS[link.dominantRoute] ?? ROUTE_COLORS.other;
      // Use rgba() — canvas doesn't reliably support 8-digit hex
      ctx.strokeStyle = isDimmed
        ? hexToRgba(color, 0.06)
        : hexToRgba(color, 1.0);
      ctx.lineWidth = isDimmed ? 0.5 : getEdgeWidth(link.weight);
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
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
        linkCanvasObject={paintLink as never}
        onNodeHover={handleNodeHover as never}
        onNodeClick={handleNodeClick as never}
        onBackgroundClick={handleBgClick}
        onEngineStop={handleEngineStop}
        nodeLabel=""
        linkLabel=""
        cooldownTicks={150}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        warmupTicks={80}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        minZoom={1}
        maxZoom={8}
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
