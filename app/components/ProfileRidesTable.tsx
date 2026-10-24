/**
 * ProfileRidesTable — sortable, paginated table of ALL user rides.
 *
 * Features:
 * - Shows ALL rides (SF2G and non-SF2G), not just classified ones
 * - Server-side pagination (25 per page)
 * - Server-side search (debounced 300ms) and sort (across all pages, T14)
 * - Route category filter chips
 * - Route category tag (or "—" for non-SF2G rides)
 * - Unit-aware formatting (mi/km)
 * - Edit button for own profile
 */
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RouteTag } from "./RouteTag";
import { useUnit } from "../lib/useUnit";
import { currentUserQueryOptions } from "../queries/user";
import { allUserRidesQueryOptions } from "../queries/rides";
import { EditRideDialog } from "./EditRideDialog";
import type { EditRideData } from "./EditRideDialog";
import type { Ride, RouteCategory } from "../lib/database.types";
import { Tooltip } from "./Tooltip";
import { ROUTE_LABELS, ROUTE_COLORS } from "../lib/constants";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatMovingTime,
  formatRideDate,
} from "../lib/leaderboard-utils";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";

interface ProfileRidesTableProps {
  profileUserId: string;
}

const PAGE_SIZE = 25;

const FILTER_ROUTES = ["bayway", "skyline", "hmbw", "royale"] as const;

function profileColumns({
  unit,
  isOwnProfile,
  onEdit,
}: {
  unit: ReturnType<typeof useUnit>;
  isOwnProfile: boolean;
  onEdit: (ride: EditRideData) => void;
}): ColumnDef<Ride, any>[] {
  const columns: ColumnDef<Ride, any>[] = [
    {
      accessorKey: "ride_date",
      header: "Date",
      cell: (info) => formatRideDate(info.getValue()) ?? "—",
    },
    {
      accessorKey: "name",
      header: "Ride Name",
      meta: { className: "profile-rides__name-col", defaultDir: "asc" },
      cell: ({ row: { original: ride } }) =>
        ride.strava_activity_id ? (
          <a
            href={`https://www.strava.com/activities/${String(ride.strava_activity_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-rides__strava-link"
            title={ride.name ?? undefined}
          >
            {ride.name ?? "—"}
          </a>
        ) : (
          (ride.name ?? "—")
        ),
    },
    {
      accessorKey: "route_category",
      header: "Route",
      meta: { defaultDir: "asc" },
      cell: ({ row: { original: ride } }) => (
        <div className="profile-rides__route-cell">
          {ride.route_category ? (
            <RouteTag category={ride.route_category as RouteCategory} />
          ) : (
            <span className="text-muted">—</span>
          )}
          {ride.is_hidden && (
            <span className="profile-rides__excluded-badge">Excluded</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "average_speed_mps",
      header: "Avg Speed",
      cell: (info) => formatSpeed(info.getValue(), unit),
    },
    {
      accessorKey: "distance_meters",
      header: "Distance",
      cell: (info) => formatDistance(info.getValue(), unit),
    },
    {
      accessorKey: "elevation_gain_meters",
      header: "Elevation",
      cell: (info) => formatElevation(info.getValue(), unit),
    },
    {
      accessorKey: "moving_time_seconds",
      header: "Time",
      cell: (info) => formatMovingTime(info.getValue()),
    },
  ];
  if (isOwnProfile) {
    columns.push({
      id: "edit",
      header: "",
      enableSorting: false,
      enableResizing: false,
      size: 48,
      meta: { className: "profile-rides__edit-col" },
      cell: ({ row: { original: ride } }) => (
        <Tooltip
          content={
            ride.is_hidden ? "Restore / edit this ride" : "Edit this ride"
          }
        >
          <button
            className={`edit-ride-btn${ride.is_hidden ? " edit-ride-btn--restore" : ""}`}
            onClick={() =>
              onEdit({
                id: ride.id,
                name: ride.name,
                rideDate: ride.ride_date,
                routeCategory: ride.route_category as RouteCategory | null,
                stravaActivityId: ride.strava_activity_id,
                isHidden: ride.is_hidden ?? undefined,
              })
            }
            aria-label={ride.is_hidden ? "Restore ride" : "Edit ride"}
          >
            {ride.is_hidden ? "↩️" : "✏️"}
          </button>
        </Tooltip>
      ),
    });
  }
  return columns;
}

export function ProfileRidesTable({ profileUserId }: ProfileRidesTableProps) {
  const unit = useUnit();
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const [editingRide, setEditingRide] = useState<EditRideData | null>(null);
  const isOwnProfile = currentUser?.id === profileUserId;
  const [sort, setSort] = useState<{ sortBy: string; sortDir: SortDir }>({
    sortBy: "ride_date",
    sortDir: "desc",
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState<string[]>([]);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Back to page 1 whenever the filter or the order changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, routeFilter, sort]);

  // Sorted by the server across all of the rider's rides (T14).
  const {
    data: rides,
    isLoading,
    error,
  } = useQuery(
    allUserRidesQueryOptions(
      profileUserId,
      page,
      PAGE_SIZE,
      debouncedSearch || undefined,
      routeFilter.length > 0 ? routeFilter : undefined,
      sort,
    ),
  );

  const columns = useMemo(
    () => profileColumns({ unit, isOwnProfile, onEdit: setEditingRide }),
    [unit, isOwnProfile],
  );
  const table = useDataTable({
    data: rides ?? [],
    columns,
    sort: sort.sortBy,
    dir: sort.sortDir,
    onSortChange: (sortBy, sortDir) => setSort({ sortBy, sortDir }),
    getRowId: (r) => r.id,
  });

  const hasMore = rides?.length === PAGE_SIZE;
  const totalShown = (page - 1) * PAGE_SIZE + (rides?.length ?? 0);

  return (
    <div className="profile-rides">
      {/* Ride count + pagination info */}
      <div className="profile-rides__filter-row">
        <span className="profile-rides__count">
          All rides · Page {page}
          {isLoading ? "" : ` (${totalShown} shown)`}
        </span>
        <input
          id="profile-rides-search"
          type="text"
          className="profile-rides__search"
          placeholder="Search rides…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Route filter chips */}
      <div className="profile-route-chips">
        {FILTER_ROUTES.map((route) => {
          const isActive = routeFilter.includes(route);
          return (
            <button
              key={route}
              className={`filter-chip${isActive ? " filter-chip--active" : ""}`}
              style={
                isActive
                  ? {
                      backgroundColor: ROUTE_COLORS[route as RouteCategory],
                      borderColor: ROUTE_COLORS[route as RouteCategory],
                    }
                  : {}
              }
              onClick={() => {
                setRouteFilter((prev) =>
                  prev.includes(route)
                    ? prev.filter((r) => r !== route)
                    : [...prev, route],
                );
              }}
            >
              {ROUTE_LABELS[route as RouteCategory]}
            </button>
          );
        })}
      </div>

      <DataTable
        table={table}
        ariaLabel="All rides"
        className="profile-rides__table-wrapper"
        tableClassName="profile-rides__table"
        isLoading={isLoading}
        error={error}
        skeletonRows={5}
        getRowProps={(row) => ({
          className: row.original.is_hidden
            ? "profile-rides__row--excluded"
            : undefined,
        })}
        empty={<TableEmpty icon="🚴" title="No rides found" />}
      />

      {/* Pagination controls */}
      <div className="profile-rides__pagination">
        <button
          className="btn btn--ghost btn--sm"
          disabled={page === 1 || isLoading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Previous
        </button>
        <span className="profile-rides__page-info">Page {page}</span>
        <button
          className="btn btn--ghost btn--sm"
          disabled={!hasMore || isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </button>
      </div>

      {/* Edit Ride Dialog */}
      {editingRide && (
        <EditRideDialog
          ride={editingRide}
          isOpen={!!editingRide}
          onClose={() => setEditingRide(null)}
        />
      )}
    </div>
  );
}
