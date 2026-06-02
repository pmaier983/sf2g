/**
 * TanStack Query options for the rider network data.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchRiderNetwork } from '../server/network'

/**
 * Query options for the full rider network graph.
 *
 * - queryKey: ['rider-network']
 * - staleTime: 10 minutes (network data changes slowly)
 * - gcTime: 1 hour (keep in cache for revisits)
 */
export function networkQueryOptions() {
  return queryOptions({
    queryKey: ['rider-network'] as const,
    queryFn: () => fetchRiderNetwork(),
    staleTime: 600_000, // 10 minutes
    gcTime: 3_600_000, // 1 hour
  })
}
