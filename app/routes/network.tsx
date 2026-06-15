/**
 * Network page — /network
 *
 * Interactive force-directed graph showing how SF2G riders are connected
 * through shared rides. Supports a "My Network" ego-graph focus mode.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, lazy, Suspense } from "react";
import { networkQueryOptions } from "../queries/network";
import { currentUserQueryOptions } from "../queries/user";

// Lazy-load NetworkGraph — it depends on react-force-graph-2d which
// requires browser APIs (window, canvas) and crashes during SSR.
const NetworkGraph = lazy(() =>
  import("../components/NetworkGraph").then((m) => ({
    default: m.NetworkGraph,
  })),
);
import { NetworkStats } from "../components/NetworkStats";
import { NetworkSidebar } from "../components/NetworkSidebar";
import { getEgoNeighbors } from "../lib/graph-utils";
import { ROUTE_LABELS, ROUTE_COLORS } from "../lib/constants";
import type { RouteCategory } from "../lib/database.types";
import "../styles/network.css";

export const Route = createFileRoute("/network")({
  component: NetworkPage,
  head: () => ({
    meta: [
      { title: "Rider Network — SF2G" },
      {
        name: "description",
        content: "See how SF2G riders are connected through shared rides",
      },
    ],
  }),
});

function NetworkPage() {
  const { data, isLoading, error } = useQuery(networkQueryOptions());
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const [focusMode, setFocusMode] = useState<"full" | "ego">("full");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // In ego mode, filter to only the current user + their direct connections
  const filteredData = useMemo(() => {
    if (!data) return null;
    if (focusMode !== "ego" || !currentUser) return data;

    const egoSet = getEgoNeighbors(data.edges, currentUser.id);
    const filteredNodes = data.nodes.filter((n) => egoSet.has(n.id));
    const filteredEdges = data.edges.filter(
      (e) => egoSet.has(e.source) && egoSet.has(e.target),
    );

    // Recompute stats for the ego graph
    const connectedCount = filteredNodes.filter(
      (n) => n.connectionCount > 0,
    ).length;

    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      stats: {
        ...data.stats,
        totalConnections: filteredEdges.length,
        totalRiders: filteredNodes.length,
        avgConnectionsPerRider:
          connectedCount > 0
            ? Math.round(((filteredEdges.length * 2) / connectedCount) * 10) /
              10
            : 0,
        isolatedRiders: filteredNodes.filter((n) => n.connectionCount === 0)
          .length,
      },
    };
  }, [data, focusMode, currentUser]);

  // Route color legend entries
  const legendRoutes: RouteCategory[] = [
    "bayway",
    "skyline",
    "hmbw",
    "royale",
    "fleaway",
    "mebw",
    "febw",
  ];

  if (isLoading) {
    return (
      <section className="network-page">
        <div className="loading-state">
          <div className="loading-state__spinner" />
          <p>Loading rider network…</p>
        </div>
      </section>
    );
  }

  if (error || !filteredData) {
    return (
      <section className="network-page">
        <div className="error-state">
          <p>Failed to load the rider network.</p>
          <p className="error-state__detail">
            {error instanceof Error
              ? error.message
              : "An unexpected error occurred."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="network-page">
      {/* Header */}
      <header className="network-page__header">
        <div className="network-page__title-row">
          <h1 className="network-page__title">Rider Network</h1>
          <span className="network-page__subtitle">
            Connections based on shared rides with GPS route overlap
          </span>
        </div>
        <div className="network-page__controls">
          {currentUser && (
            <button
              className={`btn btn--sm ${
                focusMode === "ego" ? "btn--primary" : "btn--ghost"
              }`}
              onClick={() =>
                setFocusMode((m) => (m === "full" ? "ego" : "full"))
              }
            >
              {focusMode === "ego" ? "🌐 Full Network" : "👤 My Network"}
            </button>
          )}
        </div>
      </header>

      {/* Legend */}
      <div className="network-page__legend">
        {legendRoutes.map((route) => (
          <span key={route} className="network-page__legend-item">
            <span
              className="network-page__legend-dot"
              style={{
                backgroundColor: ROUTE_COLORS[route],
              }}
            />
            {ROUTE_LABELS[route]}
          </span>
        ))}
        <span className="network-page__legend-hint">
          Node size = total rides · Edge thickness = rides together
        </span>
      </div>

      {/* Graph + Sidebar layout */}
      <div className="network-page__body">
        <div className="network-page__graph-container">
          <Suspense
            fallback={
              <div className="loading-state">
                <div className="loading-state__spinner" />
                <p>Loading graph…</p>
              </div>
            }
          >
            <NetworkGraph
              nodes={filteredData.nodes}
              edges={filteredData.edges}
              currentUserId={currentUser?.id}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
            />
          </Suspense>
        </div>

        {selectedNodeId && (
          <NetworkSidebar
            selectedNodeId={selectedNodeId}
            nodes={filteredData.nodes}
            edges={filteredData.edges}
            currentUserId={currentUser?.id}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      {/* Stats */}
      <NetworkStats stats={filteredData.stats} />
    </section>
  );
}
