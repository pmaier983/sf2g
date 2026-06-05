/**
 * TanStack Query options for user rides data.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchUserRides, fetchRidesLeaderboard, fetchCommunityStartHours, fetchCommunityStreaks } from '../server/rides'
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

/**
 * Query options for ALL of a user's rides (including non-SF2G).
 * Paginated server-side for the profile Ride History table.
 *
 * - queryKey: ['allUserRides', userId, page]
 * - staleTime: 2 minutes
 */
export function allUserRidesQueryOptions(userId: string, page: number, pageSize = 25) {
  return queryOptions({
    queryKey: ['allUserRides', userId, page, pageSize] as const,
    queryFn: () => fetchUserRides({
      data: {
        userId,
        includeAllRides: true,
        includeHidden: true,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    }),
    staleTime: 120_000,
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
// Community start hours (for percentile comparison)
// ---------------------------------------------------------------------------

/**
 * Query options for community start hours.
 *
 * - queryKey: ['community-start-hours']
 * - staleTime: 30 minutes (data changes slowly)
 * - gcTime: 1 hour
 */
export function communityStartHoursQueryOptions() {
  return queryOptions({
    queryKey: ['community-start-hours'] as const,
    queryFn: () => fetchCommunityStartHours(),
    staleTime: 30 * 60 * 1000,  // 30 minutes
    gcTime: 60 * 60 * 1000,     // 1 hour
  })
}

// ---------------------------------------------------------------------------
// Community streaks (for streak percentile comparison)
// ---------------------------------------------------------------------------

/**
 * Query options for community weekly streaks.
 *
 * - queryKey: ['community-streaks']
 * - staleTime: 30 minutes (data changes slowly)
 * - gcTime: 1 hour
 */
export function communityStreaksQueryOptions() {
  return queryOptions({
    queryKey: ['community-streaks'] as const,
    queryFn: () => fetchCommunityStreaks(),
    staleTime: 30 * 60 * 1000,  // 30 minutes
    gcTime: 60 * 60 * 1000,     // 1 hour
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
  includeOther?: boolean
  excludeWeekends?: boolean
  pprRideIds?: string[]
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
