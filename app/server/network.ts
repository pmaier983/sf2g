/**
 * Server function for the rider network feature.
 *
 * Nodes and edges come from get_rider_network (SQL, migration 040): co-ride
 * pairs (same date + route + overlapping time) whose GPS tracks overlap at
 * least 30%, aggregated per rider pair. Only the summary stats are computed
 * here.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type { RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkNode {
  id: string;
  name: string;
  avatar: string | null;
  totalRides: number;
  primaryRoute: RouteCategory;
  connectionCount: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
  routes: Partial<Record<RouteCategory, number>>;
}

export interface NetworkStats {
  totalConnections: number;
  avgConnectionsPerRider: number;
  mostConnectedRider: { name: string; id: string; connections: number } | null;
  strongestBond: {
    rider1: string;
    rider2: string;
    rider1Id: string;
    rider2Id: string;
    rides: number;
  } | null;
  communities: number;
  networkDensity: number;
  isolatedRiders: number;
  totalRiders: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  stats: NetworkStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server Function
// ---------------------------------------------------------------------------

export async function fetchRiderNetworkImpl(): Promise<NetworkData> {
  const supabase = createAnonClient();

  // Nodes and edges are aggregated in SQL (get_rider_network, migration 040);
  // polyline overlap is computed once per co-ride pair when the co-occurrence
  // view refreshes, not on every page view.
  const { data, error } = await supabase.rpc("get_rider_network");
  if (error) {
    throw new Error(`Failed to fetch rider network: ${error.message}`);
  }
  const network = (data ?? { riders: [], edges: [] }) as unknown as {
    riders: Array<{
      id: string;
      name: string;
      avatar: string | null;
      totalRides: number;
      primaryRoute: RouteCategory;
    }>;
    edges: NetworkEdge[];
  };
  const edges = network.edges;
  const nameById = new Map(network.riders.map((r) => [r.id, r.name]));

  // 6. Compute degree centrality for node connectionCount
  const degreeMap = new Map<string, number>();
  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  }

  // 7. Nodes: every rider with a visible SF2G ride (isolated riders included)
  const nodes: NetworkNode[] = network.riders.map((rider) => ({
    ...rider,
    connectionCount: degreeMap.get(rider.id) ?? 0,
  }));

  // 8. Compute network stats
  const connectedRiders = nodes.filter((n) => n.connectionCount > 0);
  const isolatedRiders = nodes.filter((n) => n.connectionCount === 0);

  // Find most connected rider
  let mostConnected: NetworkStats["mostConnectedRider"] = null;
  let maxConnections = 0;
  for (const node of nodes) {
    if (node.connectionCount > maxConnections) {
      maxConnections = node.connectionCount;
      mostConnected = {
        name: node.name,
        id: node.id,
        connections: node.connectionCount,
      };
    }
  }

  // Find strongest bond
  let strongestBondEdge: NetworkEdge | null = null;
  let maxWeight = 0;
  for (const edge of edges) {
    if (edge.weight > maxWeight) {
      maxWeight = edge.weight;
      strongestBondEdge = edge;
    }
  }

  let strongestBond: NetworkStats["strongestBond"] = null;
  if (strongestBondEdge) {
    strongestBond = {
      rider1: nameById.get(strongestBondEdge.source) ?? "Unknown",
      rider2: nameById.get(strongestBondEdge.target) ?? "Unknown",
      rider1Id: strongestBondEdge.source,
      rider2Id: strongestBondEdge.target,
      rides: strongestBondEdge.weight,
    };
  }

  // Community detection: simple connected components
  const visited = new Set<string>();
  let communities = 0;
  const allConnectedIds = new Set<string>();
  for (const edge of edges) {
    allConnectedIds.add(edge.source);
    allConnectedIds.add(edge.target);
  }

  for (const nodeId of allConnectedIds) {
    if (visited.has(nodeId)) continue;
    communities++;

    // BFS
    const queue = [nodeId];
    visited.add(nodeId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        let neighbor: string | null = null;
        if (edge.source === current) neighbor = edge.target;
        else if (edge.target === current) neighbor = edge.source;
        if (neighbor && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Network density
  const n = nodes.length;
  const maxEdges = (n * (n - 1)) / 2;
  const density = maxEdges > 0 ? edges.length / maxEdges : 0;

  // Average connections per rider (only among connected riders)
  const avgConnections =
    connectedRiders.length > 0
      ? connectedRiders.reduce((sum, r) => sum + r.connectionCount, 0) /
        connectedRiders.length
      : 0;

  const stats: NetworkStats = {
    totalConnections: edges.length,
    avgConnectionsPerRider: Math.round(avgConnections * 10) / 10,
    mostConnectedRider: mostConnected,
    strongestBond,
    communities,
    networkDensity: Math.round(density * 1000) / 1000,
    isolatedRiders: isolatedRiders.length,
    totalRiders: nodes.length,
  };

  return { nodes, edges, stats };
}

export const fetchRiderNetwork = createServerFn({ method: "GET" }).handler(() =>
  fetchRiderNetworkImpl(),
);
