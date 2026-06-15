/**
 * TanStack Query option factories for Group Rides.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { fetchGroupRides, fetchGroupRideDetail } from "../server/group-rides";
import type { RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Group rides list query (leaderboard tab) — infinite scroll
// ---------------------------------------------------------------------------

export const groupRidesQueryOptions = (params: {
  page?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  dateFrom?: string;
  dateTo?: string;
  routeCategories?: string[];
  weekends?: boolean;
}) =>
  infiniteQueryOptions({
    queryKey: ["group-rides", params],
    queryFn: ({ pageParam = 1 }) =>
      fetchGroupRides({ data: { ...params, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.totalCount
        ? lastPage.page + 1
        : undefined,
  });

// ---------------------------------------------------------------------------
// Group ride detail query (detail page)
// ---------------------------------------------------------------------------

export const groupRideDetailQueryOptions = (params: {
  id: string;
  date: string;
  route: RouteCategory;
  riderIds: string[];
}) =>
  queryOptions({
    queryKey: ["group-ride", params.id],
    queryFn: () => fetchGroupRideDetail({ data: params }),
    staleTime: 5 * 60_000, // cached streams don't change
  });
