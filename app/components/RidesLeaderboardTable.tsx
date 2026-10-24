import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import type { RideLeaderboardEntry } from "../lib/database.types";
import { currentUserQueryOptions } from "../queries/user";
import { EditRideDialog } from "./EditRideDialog";
import type { EditRideData } from "./EditRideDialog";
import { Tooltip } from "./Tooltip";
import {
  formatSpeed,
  formatDistance,
  formatElevation,
  formatRideDate,
  formatMovingTime,
} from "../lib/leaderboard-utils";

import { useUnit } from "../lib/useUnit";
import { RouteTag } from "./RouteTag";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable } from "./table/useDataTable";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface RidesLeaderboardTableProps {
  rides: RideLeaderboardEntry[];
  isLoading: boolean;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  activeUser?: string | null;
  onClearUser?: () => void;
  error?: Error | null;
}

// ---------------------------------------------------------------------------
// Columns (keys match the server's sort allow-list, app/lib/table-query.ts)
// ---------------------------------------------------------------------------
interface RideColumnsContext {
  unit: ReturnType<typeof useUnit>;
  currentUserId?: string;
  onEdit: (ride: EditRideData) => void;
}

function rideColumns({
  unit,
  currentUserId,
  onEdit,
}: RideColumnsContext): ColumnDef<RideLeaderboardEntry, any>[] {
  const watts = (v: number | null) => (v != null ? `${Math.round(v)}W` : "—");
  return [
    {
      id: "rank",
      header: "#",
      enableSorting: false,
      size: 50,
      meta: {
        className: "rides-table__rank",
        title: "Row number in the current sort order",
      },
      cell: (info) => info.row.index + 1,
    },
    {
      accessorKey: "display_name",
      header: "Rider",
      meta: {
        defaultDir: "asc",
        title: "Rider name — click to sort by name or view their profile",
      },
      cell: ({ row: { original: ride } }) => (
        <div className="rides-table__rider">
          {ride.avatar_url ? (
            <img
              className="rides-table__avatar"
              src={ride.avatar_url}
              alt=""
              loading="lazy"
              width={32}
              height={32}
            />
          ) : (
            <span className="rides-table__avatar-fallback" aria-hidden="true">
              👤
            </span>
          )}
          <Link
            to="/profile/$userId"
            params={{ userId: ride.user_id }}
            className="rides-table__rider-name"
          >
            {ride.display_name ?? "Unknown Rider"}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: "name",
      header: "Ride Name",
      meta: {
        defaultDir: "asc",
        className: "rides-table__ride-name",
        title: "Strava activity name — click header to sort alphabetically",
      },
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
      accessorKey: "ride_date",
      header: "Date",
      meta: { title: "Ride date — click header to sort by date" },
      cell: (info) => formatRideDate(info.getValue()) ?? "—",
    },
    {
      accessorKey: "route_category",
      header: "Route",
      meta: {
        defaultDir: "asc",
        title: "Classified SF2G route corridor (Bayway, Skyline, HMBW, etc.)",
      },
      cell: (info) =>
        info.getValue() ? (
          <RouteTag category={info.getValue()} />
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      accessorKey: "average_speed_mps",
      header: "Avg Speed",
      meta: { title: "Average moving speed for the ride" },
      cell: (info) => formatSpeed(info.getValue(), unit),
    },
    {
      accessorKey: "distance_meters",
      header: "Distance",
      meta: { title: "Total ride distance" },
      cell: (info) => formatDistance(info.getValue(), unit),
    },
    {
      accessorKey: "elevation_gain_meters",
      header: "Elevation",
      meta: { title: "Total elevation gain for the ride" },
      cell: (info) => formatElevation(info.getValue(), unit),
    },
    {
      accessorKey: "moving_time_seconds",
      header: "Time",
      meta: { title: "Total moving time (excludes stopped time)" },
      cell: (info) => formatMovingTime(info.getValue()),
    },
    {
      accessorKey: "average_watts",
      header: "Avg W",
      meta: { title: "Average watts (power meter required)" },
      cell: (info) => watts(info.getValue()),
    },
    {
      accessorKey: "max_watts",
      header: "Max W",
      meta: { title: "Maximum watts" },
      cell: (info) => watts(info.getValue()),
    },
    {
      accessorKey: "average_heartrate",
      header: "Avg HR",
      meta: { title: "Average heart rate (HR monitor required)" },
      cell: (info) =>
        info.getValue() != null ? `${Math.round(info.getValue())}bpm` : "—",
    },
    {
      accessorKey: "kilojoules",
      header: "Cal",
      meta: { title: "Calories burned (estimated from Strava kilojoules)" },
      cell: (info) =>
        info.getValue() != null ? Math.round(info.getValue()) : "—",
    },
    {
      id: "edit",
      header: "",
      enableSorting: false,
      enableResizing: false,
      size: 48,
      meta: { className: "rides-table__edit-col", title: "Edit ride" },
      cell: ({ row: { original: ride } }) =>
        currentUserId && currentUserId === ride.user_id ? (
          <Tooltip content="Edit this ride">
            <button
              className="edit-ride-btn"
              onClick={() =>
                onEdit({
                  id: ride.id,
                  name: ride.name,
                  rideDate: ride.ride_date,
                  routeCategory: ride.route_category,
                  stravaActivityId: ride.strava_activity_id,
                })
              }
              aria-label="Edit ride"
            >
              ✏️
            </button>
          </Tooltip>
        ) : null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RidesLeaderboardTable({
  rides,
  isLoading,
  sortBy,
  sortDir,
  onSortChange,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  activeUser,
  onClearUser,
  error,
}: RidesLeaderboardTableProps) {
  const unit = useUnit();
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const [editingRide, setEditingRide] = useState<EditRideData | null>(null);

  const columns = useMemo(
    () =>
      rideColumns({
        unit,
        currentUserId: currentUser?.id,
        onEdit: setEditingRide,
      }),
    [unit, currentUser?.id],
  );
  const table = useDataTable({
    data: rides,
    columns,
    sort: sortBy,
    dir: sortDir,
    onSortChange,
    getRowId: (r) => r.id,
  });

  // Active user display name (find from first ride that matches)
  const activeUserName =
    activeUser && rides.length > 0
      ? (rides.find((r) => r.user_id === activeUser)?.display_name ?? "Rider")
      : null;

  return (
    <div className="rides-table">
      {/* User filter banner */}
      {activeUser && activeUserName && (
        <div className="rides-table__user-banner">
          <span>
            Showing rides for <strong>{activeUserName}</strong>
          </span>
          {onClearUser && (
            <button
              className="rides-table__clear-btn"
              onClick={onClearUser}
              aria-label="Clear rider filter"
            >
              ✕ Clear filter
            </button>
          )}
        </div>
      )}

      <DataTable
        table={table}
        ariaLabel="Rides leaderboard"
        className="rides-table__wrapper"
        isLoading={isLoading}
        error={error}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
        empty={
          <TableEmpty icon="🚴" title="No rides found">
            No rides match the current filters.
          </TableEmpty>
        }
      />

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
