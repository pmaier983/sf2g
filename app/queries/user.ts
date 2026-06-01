/**
 * TanStack Query options for current user data.
 */
import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '../server/auth'

/**
 * Query options for the currently logged-in user.
 *
 * - queryKey: ['currentUser']
 * - staleTime: 10 minutes (600,000ms)
 */
export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: ['currentUser'] as const,
    queryFn: () => getCurrentUser(),
    staleTime: 600_000, // 10 minutes
  })
}
