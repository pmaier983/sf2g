/**
 * TanStack Query options for leaderboard data.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  fetchLeaderboard,
  fetchPprDawnRiderIds,
  fetchRiderGrowthData,
  fetchDailyGrowthData,
  fetchRouteSpeedLeaderboard,
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

export function pprDawnRiderIdsQueryOptions(params?: {
  dateFrom?: string;
  dateTo?: string;
  routeCategories?: string[];
}) {
  return queryOptions({
    queryKey: ["ppr-dawn-riders", params ?? {}] as const,
    queryFn: async () =>
      (await fetchPprDawnRiderIds({ data: params ?? {} })) ?? {
        riderIds: [],
        rideCounts: {},
        rideIds: [],
      },
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function riderGrowthQueryOptions() {
  return queryOptions({
    queryKey: ["rider-growth"] as const,
    queryFn: async () => (await fetchRiderGrowthData()) ?? [],
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function dailyGrowthQueryOptions() {
  return queryOptions({
    queryKey: ["daily-growth"] as const,
    queryFn: async () => (await fetchDailyGrowthData()) ?? [],
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}

export function routeSpeedLeaderboardQueryOptions(
  routeCategory: RouteCategory,
) {
  return queryOptions({
    queryKey: ["route-speed-leaderboard", routeCategory] as const,
    queryFn: async () =>
      (await fetchRouteSpeedLeaderboard({ data: { routeCategory } })) ?? [],
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
