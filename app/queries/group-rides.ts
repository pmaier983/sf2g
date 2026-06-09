/**
 * TanStack Query option factories for Group Rides.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchGroupRides, fetchGroupRideDetail } from '../server/group-rides'
import type { RouteCategory } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Group rides list query (leaderboard tab)
// ---------------------------------------------------------------------------

export const groupRidesQueryOptions = (params: {
  page?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  dateFrom?: string
  dateTo?: string
}) =>
  queryOptions({
    queryKey: ['group-rides', params],
    queryFn: () => fetchGroupRides({ data: params }),
  })

// ---------------------------------------------------------------------------
// Group ride detail query (detail page)
// ---------------------------------------------------------------------------

export const groupRideDetailQueryOptions = (params: {
  id: string
  date: string
  route: RouteCategory
  riderIds: string[]
}) =>
  queryOptions({
    queryKey: ['group-ride', params.id],
    queryFn: () => fetchGroupRideDetail({ data: params }),
    staleTime: 5 * 60_000, // cached streams don't change
  })
