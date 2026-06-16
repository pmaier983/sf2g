/**
 * Server function for the rider network feature.
 *
 * Fetches co-ride candidate pairs from the `ride_co_occurrences` materialized
 * view (Layer 1 + Layer 2), applies polyline overlap analysis (Layer 3),
 * aggregates into edges, and returns the full network data shape.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import { computePolylineOverlap } from "../lib/polyline-overlap";
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

/** Minimum polyline overlap ratio to consider two rides as "together" */
const MIN_POLYLINE_OVERLAP = 0.3;

/**
 * Determine the primary route category for a rider based on their ride counts.
 */
function getPrimaryRoute(rider: {
  bayway_count: number;
  skyline_count: number;
  hmbw_count: number;
  royale_count: number;
  fleaway_count: number;
  mebw_count: number;
  febw_count: number;
}): RouteCategory {
  const routes: [RouteCategory, number][] = [
    ["bayway", rider.bayway_count ?? 0],
    ["skyline", rider.skyline_count ?? 0],
    ["hmbw", rider.hmbw_count ?? 0],
    ["royale", rider.royale_count ?? 0],
    ["fleaway", rider.fleaway_count ?? 0],
    ["mebw", rider.mebw_count ?? 0],
    ["febw", rider.febw_count ?? 0],
  ];

  routes.sort((a, b) => b[1] - a[1]);
  return routes[0][1] > 0 ? routes[0][0] : "other";
}

// ---------------------------------------------------------------------------
// Server Function
// ---------------------------------------------------------------------------

export const fetchRiderNetwork = createServerFn({ method: "GET" }).handler(
  async (): Promise<NetworkData> => {
    const supabase = createAnonClient();

    // 1. Fetch candidate co-ride pairs from the materialized view
    // Paginate to work around Supabase max_rows (1000) truncation
    type CoRideRow = {
      rider1_id: string;
      rider2_id: string;
      route_category: string;
      polyline1: string | null;
      polyline2: string | null;
    };
    const CO_RIDE_PAGE_SIZE = 1000;
    const allCoRides: CoRideRow[] = [];
    let coRideOffset = 0;
    let coRideHasMore = true;

    while (coRideHasMore) {
      const { data: page, error: pageError } = await supabase
        .from("ride_co_occurrences" as never)
        .select("rider1_id, rider2_id, route_category, polyline1, polyline2")
        .order("rider1_id", { ascending: true })
        .range(coRideOffset, coRideOffset + CO_RIDE_PAGE_SIZE - 1);

      if (pageError) {
        throw new Error(`Failed to fetch co-ride data: ${pageError.message}`);
      }

      if (!page || page.length === 0) {
        coRideHasMore = false;
      } else {
        allCoRides.push(...(page as CoRideRow[]));
        coRideOffset += page.length;
        if (page.length < CO_RIDE_PAGE_SIZE) {
          coRideHasMore = false;
        }
      }
    }
    console.log(
      `[network] Paginated fetch: ${allCoRides.length} total co-ride rows`,
    );
    const coRides = allCoRides;

    // 2. Fetch rider metadata from leaderboard view
    // Paginate to work around Supabase max_rows (1000) truncation
    const RIDER_PAGE_SIZE = 1000;
    const allRiders: Record<string, unknown>[] = [];
    let riderOffset = 0;
    let riderHasMore = true;

    while (riderHasMore) {
      const { data: page, error: pageError } = await supabase
        .from("leaderboard_view")
        .select(
          "user_id, display_name, avatar_url, sf2g_total, bayway_count, skyline_count, hmbw_count, royale_count, fleaway_count, mebw_count, febw_count",
        )
        .order("user_id", { ascending: true })
        .range(riderOffset, riderOffset + RIDER_PAGE_SIZE - 1);

      if (pageError) {
        throw new Error(`Failed to fetch rider data: ${pageError.message}`);
      }

      if (!page || page.length === 0) {
        riderHasMore = false;
      } else {
        allRiders.push(...(page as Record<string, unknown>[]));
        riderOffset += page.length;
        if (page.length < RIDER_PAGE_SIZE) {
          riderHasMore = false;
        }
      }
    }
    console.log(
      `[network] Paginated fetch: ${allRiders.length} total rider rows`,
    );
    const riders = allRiders as Array<{
      user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
      sf2g_total: number | null;
      bayway_count: number | null;
      skyline_count: number | null;
      hmbw_count: number | null;
      royale_count: number | null;
      fleaway_count: number | null;
      mebw_count: number | null;
      febw_count: number | null;
    }>;

    // 3. Build rider lookup
    const riderMap = new Map<
      string,
      {
        display_name: string | null;
        avatar_url: string | null;
        sf2g_total: number;
        bayway_count: number;
        skyline_count: number;
        hmbw_count: number;
        royale_count: number;
        fleaway_count: number;
        mebw_count: number;
        febw_count: number;
      }
    >();
    for (const rider of riders ?? []) {
      if (rider.user_id != null)
        riderMap.set(rider.user_id, {
          display_name: rider.display_name,
          avatar_url: rider.avatar_url,
          sf2g_total: rider.sf2g_total ?? 0,
          bayway_count: rider.bayway_count ?? 0,
          skyline_count: rider.skyline_count ?? 0,
          hmbw_count: rider.hmbw_count ?? 0,
          royale_count: rider.royale_count ?? 0,
          fleaway_count: rider.fleaway_count ?? 0,
          mebw_count: rider.mebw_count ?? 0,
          febw_count: rider.febw_count ?? 0,
        });
    }

    // 4. Layer 3: Run polyline overlap analysis + aggregate into edges
    const edgeMap = new Map<
      string,
      {
        source: string;
        target: string;
        weight: number;
        routes: Partial<Record<RouteCategory, number>>;
      }
    >();

    const typedCoRides = (coRides ?? []) as Array<{
      rider1_id: string;
      rider2_id: string;
      route_category: RouteCategory;
      polyline1: string | null;
      polyline2: string | null;
    }>;

    for (const coRide of typedCoRides) {
      // Skip pairs where either rider isn't in the leaderboard view
      // (prevents "Unknown" riders from appearing in the network)
      if (!riderMap.has(coRide.rider1_id) || !riderMap.has(coRide.rider2_id)) {
        continue;
      }

      const hasPolylines = coRide.polyline1 && coRide.polyline2;

      // Layer 3: Check polyline spatial overlap
      if (hasPolylines) {
        const overlap = computePolylineOverlap(
          coRide.polyline1,
          coRide.polyline2,
        );
        if (overlap < MIN_POLYLINE_OVERLAP) continue; // Not actually riding together
      }

      // Accumulate into edge
      const key = `${coRide.rider1_id}::${coRide.rider2_id}`;
      const existing = edgeMap.get(key);

      if (existing) {
        existing.weight++;
        existing.routes[coRide.route_category] =
          (existing.routes[coRide.route_category] ?? 0) + 1;
      } else {
        edgeMap.set(key, {
          source: coRide.rider1_id,
          target: coRide.rider2_id,
          weight: 1,
          routes: { [coRide.route_category]: 1 },
        });
      }
    }

    // 5. Build edges array — only keep connections with ≥5 co-rides
    //    This is why not everyone appears in the graph: riders need at least
    //    5 verified co-rides (same date + time overlap + GPS overlap) with
    //    another rider to form a visible edge.
    const MIN_CONNECTION_RIDES = 5;
    const edges: NetworkEdge[] = Array.from(edgeMap.values()).filter(
      (e) => e.weight >= MIN_CONNECTION_RIDES,
    );

    // 6. Compute degree centrality for node connectionCount
    const degreeMap = new Map<string, number>();
    for (const edge of edges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
      degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }

    // 7. Build nodes array — only include riders who have valid SF2G rides
    //    AND at least one connection in the graph. Isolated riders (no co-rides
    //    meeting the ≥5 threshold) add noise without showing relationships.
    const connectedUserIds = new Set<string>();
    for (const edge of edges) {
      connectedUserIds.add(edge.source);
      connectedUserIds.add(edge.target);
    }

    const nodes: NetworkNode[] = (riders ?? [])
      .filter(
        (rider): rider is typeof rider & { user_id: string } =>
          rider.user_id != null &&
          (rider.sf2g_total ?? 0) > 0 &&
          connectedUserIds.has(rider.user_id),
      )
      .map((rider) => ({
        id: rider.user_id,
        name: rider.display_name ?? "Anonymous",
        avatar: rider.avatar_url,
        totalRides: rider.sf2g_total ?? 0,
        primaryRoute: getPrimaryRoute({
          bayway_count: rider.bayway_count ?? 0,
          skyline_count: rider.skyline_count ?? 0,
          hmbw_count: rider.hmbw_count ?? 0,
          royale_count: rider.royale_count ?? 0,
          fleaway_count: rider.fleaway_count ?? 0,
          mebw_count: rider.mebw_count ?? 0,
          febw_count: rider.febw_count ?? 0,
        }),
        connectionCount: degreeMap.get(rider.user_id) ?? 0,
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
        rider1:
          riderMap.get(strongestBondEdge.source)?.display_name ?? "Unknown",
        rider2:
          riderMap.get(strongestBondEdge.target)?.display_name ?? "Unknown",
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
  },
);
