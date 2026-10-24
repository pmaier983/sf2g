/**
 * TanStack Query options for leaderboard data.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  fetchLeaderboard,
  fetchRiderGrowth,
  type RiderGrowthInput,
  fetchCommunityBreakdown,
} from "../server/leaderboard";
import type { LeaderboardQueryInput } from "../lib/leaderboard-query";
import type { RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Riders leaderboard — one query for every filter combination
// ---------------------------------------------------------------------------
/**
 * - queryKey: ['leaderboard', params]
 * - staleTime: 5 minutes, gcTime: 30 minutes
 */
export function leaderboardQueryOptions(params: LeaderboardQueryInput = {}) {
  return queryOptions({
    queryKey: ["leaderboard", params] as const,
    queryFn: async () => (await fetchLeaderboard({ data: params })) ?? [],
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function communityBreakdownQueryOptions() {
  return queryOptions({
    queryKey: ["community-breakdown"] as const,
    queryFn: async () => (await fetchCommunityBreakdown()) ?? null,
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

/** Chart buckets for the riders on the growth chart (same filters as the table). */
export function riderGrowthQueryOptions(params: RiderGrowthInput) {
  return queryOptions({
    queryKey: ["rider-growth", params] as const,
    queryFn: async () => (await fetchRiderGrowth({ data: params })) ?? [],
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}
