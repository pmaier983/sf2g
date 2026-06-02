/**
 * Graph analysis utilities for the rider network.
 *
 * All functions operate on the client-side with pre-fetched data.
 * With ~50-100 riders and ~200-500 edges, these algorithms run in <10ms.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

// ---------------------------------------------------------------------------
// Adjacency list builder
// ---------------------------------------------------------------------------

function buildAdjacencyList(
  edges: GraphEdge[],
): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>()

  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, new Map())
    if (!adj.has(edge.target)) adj.set(edge.target, new Map())

    adj.get(edge.source)!.set(edge.target, edge.weight)
    adj.get(edge.target)!.set(edge.source, edge.weight)
  }

  return adj
}

// ---------------------------------------------------------------------------
// Connected Components (BFS)
// ---------------------------------------------------------------------------

/**
 * Find connected components in an undirected graph via BFS.
 * Returns an array of components, where each component is an array of node IDs.
 */
export function findConnectedComponents(
  nodeIds: string[],
  edges: GraphEdge[],
): string[][] {
  const adj = buildAdjacencyList(edges)
  const visited = new Set<string>()
  const components: string[][] = []

  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) continue

    // BFS from this node
    const component: string[] = []
    const queue = [nodeId]
    visited.add(nodeId)

    while (queue.length > 0) {
      const current = queue.shift()!
      component.push(current)

      const neighbors = adj.get(current)
      if (neighbors) {
        for (const [neighbor] of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
    }

    components.push(component)
  }

  // Sort by size descending (largest component first)
  components.sort((a, b) => b.length - a.length)
  return components
}

// ---------------------------------------------------------------------------
// Degree Centrality
// ---------------------------------------------------------------------------

/**
 * Compute degree centrality for each node (number of unique connections).
 */
export function degreeCentrality(
  edges: GraphEdge[],
): Map<string, number> {
  const degrees = new Map<string, number>()

  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
  }

  return degrees
}

// ---------------------------------------------------------------------------
// Shortest Path (BFS, unweighted)
// ---------------------------------------------------------------------------

/**
 * Find the shortest path length between two nodes using BFS.
 * Returns null if no path exists (different components).
 */
export function shortestPath(
  edges: GraphEdge[],
  source: string,
  target: string,
): number | null {
  if (source === target) return 0

  const adj = buildAdjacencyList(edges)
  const visited = new Set<string>()
  const queue: [string, number][] = [[source, 0]]
  visited.add(source)

  while (queue.length > 0) {
    const [current, distance] = queue.shift()!
    const neighbors = adj.get(current)

    if (neighbors) {
      for (const [neighbor] of neighbors) {
        if (neighbor === target) return distance + 1
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push([neighbor, distance + 1])
        }
      }
    }
  }

  return null // No path found
}

// ---------------------------------------------------------------------------
// Average Path Length
// ---------------------------------------------------------------------------

/**
 * Compute the average shortest path length across all reachable pairs.
 * Only considers pairs within the same connected component.
 */
export function averagePathLength(
  nodeIds: string[],
  edges: GraphEdge[],
): number {
  const adj = buildAdjacencyList(edges)
  let totalPaths = 0
  let totalLength = 0

  // BFS from each node to compute all shortest paths
  for (const startNode of nodeIds) {
    if (!adj.has(startNode)) continue

    const visited = new Map<string, number>()
    const queue: [string, number][] = [[startNode, 0]]
    visited.set(startNode, 0)

    while (queue.length > 0) {
      const [current, distance] = queue.shift()!
      const neighbors = adj.get(current)

      if (neighbors) {
        for (const [neighbor] of neighbors) {
          if (!visited.has(neighbor)) {
            visited.set(neighbor, distance + 1)
            totalPaths++
            totalLength += distance + 1
            queue.push([neighbor, distance + 1])
          }
        }
      }
    }
  }

  // Divide by 2 because we counted each pair twice (A→B and B→A)
  return totalPaths > 0 ? (totalLength / totalPaths) : 0
}

// ---------------------------------------------------------------------------
// Network Density
// ---------------------------------------------------------------------------

/**
 * Compute network density: actual edges / max possible edges.
 * For an undirected graph: density = 2E / (N * (N - 1))
 */
export function networkDensity(
  nodeCount: number,
  edgeCount: number,
): number {
  const maxEdges = (nodeCount * (nodeCount - 1)) / 2
  return maxEdges > 0 ? edgeCount / maxEdges : 0
}

// ---------------------------------------------------------------------------
// Ego Graph Filter
// ---------------------------------------------------------------------------

/**
 * Filter network data to show only a specific node and its direct connections.
 * Used for the "My Network" focus mode.
 */
export function getEgoNeighbors(
  edges: GraphEdge[],
  userId: string,
): Set<string> {
  const neighbors = new Set<string>()
  neighbors.add(userId)

  for (const edge of edges) {
    if (edge.source === userId) neighbors.add(edge.target)
    if (edge.target === userId) neighbors.add(edge.source)
  }

  return neighbors
}
