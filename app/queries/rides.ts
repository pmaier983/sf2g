/**
 * TanStack Query options for user rides data.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchUserRides, fetchRidesLeaderboard } from '../server/rides'
import type { RouteCategory } from '../lib/database.types'

/**
 * Query options for a user's ride history.
 *
 * - queryKey: ['rides', userId]
 * - staleTime: 2 minutes (120,000ms)
 */
export function userRidesQueryOptions(userId: string) {
  return queryOptions({
    queryKey: ['rides', userId] as const,
    queryFn: () => fetchUserRides({ data: { userId, limit: 10000 } }),
    staleTime: 120_000, // 2 minutes
  })
}

export function userRouteRidesQueryOptions(userId: string, routeCategory?: RouteCategory) {
  return queryOptions({
    queryKey: ['rides', userId, routeCategory ?? 'all'] as const,
    queryFn: () => fetchUserRides({ data: { userId, routeCategory, limit: 200 } }),
    staleTime: 120_000,
    gcTime: 600_000,
  })
}

// ---------------------------------------------------------------------------
// Rides leaderboard (cross-user, filterable)
// ---------------------------------------------------------------------------
export interface RidesLeaderboardParams {
  userId?: string
  routeCategories?: string[]
  company?: string
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  dateFrom?: string
  dateTo?: string
}

/**
 * Query options for the rides leaderboard.
 *
 * - queryKey: ['rides-leaderboard', params]
 * - staleTime: 5 minutes
 * - gcTime: 30 minutes
 */
export function ridesLeaderboardQueryOptions(params: RidesLeaderboardParams) {
  return queryOptions({
    queryKey: ['rides-leaderboard', params] as const,
    queryFn: () => fetchRidesLeaderboard({ data: { ...params, pageSize: 200 } }),
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 30 * 60 * 1000,    // 30 minutes
  })
}
