/**
 * TanStack Query options for current user data.
 */
import { queryOptions } from "@tanstack/react-query";
import { getCurrentUser, getMySyncState } from "../server/auth";

/**
 * Query options for the currently logged-in user.
 *
 * - queryKey: ['currentUser']
 * - staleTime: 10 minutes (600,000ms)
 */
export function currentUserQueryOptions() {
  return queryOptions({
    queryKey: ["currentUser"] as const,
    queryFn: () => getCurrentUser(),
    staleTime: 600_000, // 10 minutes
  });
}

/** The signed-in rider's sync health (reconnect banner, import progress). */
export function mySyncStateQueryOptions() {
  return queryOptions({
    queryKey: ["mySyncState"] as const,
    queryFn: () => getMySyncState(),
    staleTime: 60_000,
  });
}
