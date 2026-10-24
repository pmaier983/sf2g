import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable } from "./table/useDataTable";
import type { GroupRideSummary } from "../server/group-rides";
import { RouteTag } from "./RouteTag";
import { Tooltip } from "./Tooltip";
import { useUnit } from "../lib/useUnit";
import {
  formatSpeed,
  formatDistance,
  formatRideDate,
} from "../lib/leaderboard-utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GroupRidesTableProps {
  data: GroupRideSummary[];
  isLoading: boolean;
  onGroupRideClick: (groupRide: GroupRideSummary) => void;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  error?: Error | null;
}

// ---------------------------------------------------------------------------
// Avatar helpers
// ---------------------------------------------------------------------------

/**
 * Extract initials from a display name (first letter of first + last name).
 * Falls back to first two characters if only one word.
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Generate a deterministic gradient color from a string.
 * Used for avatar fallback backgrounds.
 */
function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 50%)`;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<GroupRideSummary>();

/**
 * Build column definitions with unit-aware formatting.
 */
function getGroupRideColumns(unit: ReturnType<typeof useUnit>) {
  return [
    columnHelper.accessor("date", {
      header: "Date",
      cell: (info) => {
        const formatted = formatRideDate(info.getValue());
        return <span style={{ whiteSpace: "nowrap" }}>{formatted ?? "—"}</span>;
      },
      size: 120,
    }),

    columnHelper.accessor("routeCategory", {
      id: "routeCategory",
      header: "Route",
      cell: (info) => <RouteTag category={info.getValue()} />,
      enableSorting: false,
      size: 110,
    }),

    columnHelper.display({
      id: "riders",
      header: "Riders",
      cell: (info) => {
        const riders = info.row.original.riders;
        const maxVisible = 5;
        const visible = riders.slice(0, maxVisible);
        const overflow = riders.length - maxVisible;

        const tooltipContent = (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {riders.map((r) => (
              <span key={r.userId}>{r.displayName}</span>
            ))}
          </div>
        );

        return (
          <Tooltip content={tooltipContent} placement="top">
            <div className="group-rides-table__avatars">
              {visible.map((rider, i) =>
                rider.avatarUrl ? (
                  <img
                    key={rider.userId}
                    src={rider.avatarUrl}
                    alt={rider.displayName}
                    className="group-rides-table__avatar"
                    style={{
                      marginLeft: i === 0 ? 0 : "-8px",
                      zIndex: visible.length - i,
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    key={rider.userId}
                    className="group-rides-table__avatar group-rides-table__avatar--fallback"
                    style={{
                      marginLeft: i === 0 ? 0 : "-8px",
                      zIndex: visible.length - i,
                      background: nameToColor(rider.displayName),
                    }}
                  >
                    {getInitials(rider.displayName)}
                  </div>
                ),
              )}
              {overflow > 0 && (
                <div
                  className="group-rides-table__avatar group-rides-table__avatar--overflow"
                  style={{
                    marginLeft: "-8px",
                    zIndex: 0,
                  }}
                >
                  +{overflow}
                </div>
              )}
            </div>
          </Tooltip>
        );
      },
      enableSorting: false,
      size: 160,
    }),

    columnHelper.accessor("riderCount", {
      header: "# Riders",
      cell: (info) => info.getValue(),
      size: 90,
    }),

    columnHelper.accessor("avgSpeedMps", {
      header: "Avg Speed",
      cell: (info) => formatSpeed(info.getValue(), unit),
      size: 110,
    }),

    columnHelper.accessor("avgWatts", {
      header: "Avg Watts",
      cell: (info) => {
        const val = info.getValue();
        if (val == null)
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
        return Math.round(val);
      },
      size: 110,
      sortUndefined: "last",
    }),

    columnHelper.accessor("avgHeartrate", {
      header: "Avg HR",
      cell: (info) => {
        const val = info.getValue();
        if (val == null)
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
        return Math.round(val);
      },
      size: 90,
      sortUndefined: "last",
    }),

    columnHelper.accessor("maxWatts", {
      header: "Max Watts",
      cell: (info) => {
        const val = info.getValue();
        if (val == null)
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
        return Math.round(val);
      },
      size: 110,
      sortUndefined: "last",
    }),

    columnHelper.accessor("maxSpeedMps", {
      header: "Max Speed",
      cell: (info) => formatSpeed(info.getValue(), unit),
      size: 110,
    }),

    columnHelper.accessor(
      (row) =>
        row.riderCount > 0 ? row.totalDistanceMeters / row.riderCount : 0,
      {
        id: "avgDistance",
        header: "Distance",
        cell: (info) => formatDistance(info.getValue(), unit),
        size: 110,
        // Average per rider: the server can't sort by it (T7).
        enableSorting: false,
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GroupRidesTable — server-sorted, infinitely scrolling (DataTable). Only
 * columns the server can sort by are sortable (T7).
 */
export function GroupRidesTable({
  data,
  isLoading,
  error,
  onGroupRideClick,
  sortBy,
  sortDir,
  onSortChange,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: GroupRidesTableProps) {
  const unit = useUnit();
  const columns = useMemo(() => getGroupRideColumns(unit), [unit]);
  const table = useDataTable({
    data,
    columns,
    sort: sortBy,
    dir: sortDir,
    onSortChange,
    getRowId: (r) => r.id,
  });

  return (
    <DataTable
      table={table}
      ariaLabel="Group rides"
      className="group-rides-table__wrapper"
      tableClassName="group-rides-table"
      isLoading={isLoading}
      error={error}
      onRowClick={(row) => onGroupRideClick(row.original)}
      hasNextPage={hasNextPage}
      fetchNextPage={fetchNextPage}
      isFetchingNextPage={isFetchingNextPage}
      empty={
        <TableEmpty icon="🚴" title="No group rides found">
          No group rides match the current filters.
        </TableEmpty>
      }
    />
  );
}
