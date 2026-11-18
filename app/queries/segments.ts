/**
 * TanStack Query options for the /segments board.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  fetchSegmentLeaderboard,
  fetchSegmentMatrix,
  type MatrixInput,
} from "../server/segments";
import type { SegmentQuery } from "../lib/segment-query";

/**
 * - queryKey: ['segments', params]
 * - staleTime: 5 minutes, gcTime: 30 minutes
 */
export function segmentLeaderboardQueryOptions(params: SegmentQuery) {
  return queryOptions({
    queryKey: ["segments", params] as const,
    queryFn: () => fetchSegmentLeaderboard({ data: params }),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

/**
 * The cumulative leaderboard's matrix (phase 09c). Keyed by the three fields
 * the RPC takes; selection changes reuse the cached matrix.
 */
export function segmentMatrixQueryOptions(params: MatrixInput) {
  const key = {
    corridor: params.corridor,
    direction: params.direction,
    year: params.year,
  };
  return queryOptions({
    queryKey: ["segments", "matrix", key] as const,
    queryFn: () => fetchSegmentMatrix({ data: key }),
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}
