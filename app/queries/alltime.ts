/**
 * TanStack Query options for the All-Time leaderboard.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchAllTimeLeaderboard } from '../server/alltime'
import type { RouteCategory } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------
export interface AllTimeParams {
  durationDays: number
  routes?: RouteCategory[]
  excludeWeekends?: boolean
  dateFrom?: string
  dateTo?: string
}

/**
 * Query options for the all-time rolling-window leaderboard.
 *
 * - queryKey: ['alltime', params]
 * - staleTime: 5 minutes
 * - gcTime: 30 minutes
 */
export function allTimeQueryOptions(params: AllTimeParams) {
  return queryOptions({
    queryKey: ['alltime', params] as const,
    queryFn: () => fetchAllTimeLeaderboard({ data: params }),
    staleTime: 5 * 60 * 1000,   // 5 minutes
    gcTime: 30 * 60 * 1000,     // 30 minutes
  })
}
