/**
 * TanStack Query options for leaderboard data.
 */
import { queryOptions } from "@tanstack/react-query";
import {
  fetchLeaderboard,
  fetchFilteredLeaderboard,
  fetchPprDawnRiderIds,
  fetchRiderGrowthData,
  fetchDailyGrowthData,
  fetchRouteSpeedLeaderboard,
  fetchCommunityBreakdown,
  fetchCompanyRiderIds,
} from "../server/leaderboard";
import type { RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Leaderboard params
// ---------------------------------------------------------------------------
export interface LeaderboardParams {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Query options for leaderboard data.
 *
 * - queryKey: ['leaderboard', params]
 * - staleTime: 5 minutes (300,000ms)
 * - gcTime: 30 minutes (1,800,000ms)
 */
export function leaderboardQueryOptions(params?: LeaderboardParams) {
  return queryOptions({
    queryKey: ["leaderboard", params ?? {}] as const,
    queryFn: async () => (await fetchLeaderboard({ data: params ?? {} })) ?? [],
    staleTime: 300_000, // 5 minutes
    gcTime: 1_800_000, // 30 minutes
  });
}

// ---------------------------------------------------------------------------
// Filtered leaderboard params (compound filters: route + company + date)
// ---------------------------------------------------------------------------
export interface FilteredLeaderboardParams {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  dateFrom?: string;
  dateTo?: string;
  routeCategories?: string[];
  company?: string;
  excludeWeekends?: boolean;
  reverse?: boolean;
}

export function filteredLeaderboardQueryOptions(
  params: FilteredLeaderboardParams,
) {
  return queryOptions({
    queryKey: ["leaderboard", params] as const,
    queryFn: async () =>
      (await fetchFilteredLeaderboard({ data: params })) ?? [],
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

export function companyRiderIdsQueryOptions(company: string | undefined) {
  return queryOptions({
    queryKey: ["company-rider-ids", company] as const,
    queryFn: async () =>
      (await fetchCompanyRiderIds({ data: { company: company! } })) ?? [],
    enabled: !!company,
    staleTime: 300_000,
    gcTime: 1_800_000,
  });
}
