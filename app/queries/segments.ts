/**
 * TanStack Query options for the /segments board.
 */
import { queryOptions } from "@tanstack/react-query";
import { fetchSegmentLeaderboard } from "../server/segments";
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
