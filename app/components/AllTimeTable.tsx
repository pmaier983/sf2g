import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { AllTimeEntry } from "../server/alltime";
import { formatRideDate } from "../lib/leaderboard-utils";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface AllTimeTableProps {
  data: AllTimeEntry[] | undefined;
  isLoading: boolean;
  error?: Error | null;
  searchFilter: string;
  durationLabel: string;
  /** Sort lives in the URL (TableQuery); the table sorts client-side. */
  sortBy: string;
  sortDir: SortDir;
  onSortChange: (column: string, direction: SortDir) => void;
  onViewRides?: (userId: string, dateFrom: string, dateTo: string) => void;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function allTimeColumns(
  onViewRides: AllTimeTableProps["onViewRides"],
): ColumnDef<AllTimeEntry, any>[] {
  return [
    {
      id: "rank",
      header: "#",
      enableSorting: false,
      size: 50,
      meta: {
        className: "alltime-table__rank",
        title: "Rank by max rides in window",
      },
      cell: (info) => info.row.index + 1,
    },
    {
      accessorKey: "displayName",
      header: "Rider",
      meta: {
        defaultDir: "asc",
        title: "Rider name — click to sort by name or view their profile",
      },
      cell: ({ row: { original: entry } }) => (
        <div className="alltime-table__rider">
          {entry.avatarUrl ? (
            <img
              className="alltime-table__avatar"
              src={entry.avatarUrl}
              alt=""
              loading="lazy"
              width={32}
              height={32}
            />
          ) : (
            <span className="alltime-table__avatar-fallback" aria-hidden="true">
              👤
            </span>
          )}
          <Link
            to="/profile/$userId"
            params={{ userId: entry.userId }}
            className="alltime-table__rider-name"
          >
            {entry.displayName}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: "maxRidesInWindow",
      header: "Max Rides",
      meta: {
        className: "alltime-table__max-rides",
        title:
          "Maximum number of SF2G rides completed within the rolling window — click to view rides",
      },
      cell: ({ row: { original: entry } }) => (
        <button
          className="leaderboard__count-btn leaderboard__total"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewRides?.(entry.userId, entry.windowStart, entry.windowEnd);
          }}
          aria-label={`View ${entry.maxRidesInWindow} rides for ${entry.displayName} from ${entry.windowStart} to ${entry.windowEnd}`}
        >
          {entry.maxRidesInWindow}
        </button>
      ),
    },
    {
      accessorKey: "windowStart",
      header: "Window Start",
      meta: { title: "Start date of the best rolling window" },
      cell: (info) => formatRideDate(info.getValue()) ?? "—",
    },
    {
      accessorKey: "windowEnd",
      header: "Window End",
      meta: { title: "End date of the best rolling window" },
      cell: (info) => formatRideDate(info.getValue()) ?? "—",
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AllTimeTable({
  data,
  isLoading,
  error,
  searchFilter,
  durationLabel,
  sortBy,
  sortDir,
  onSortChange,
  onViewRides,
}: AllTimeTableProps) {
  // Client-side search (PPR and every other filter are applied in SQL)
  const filteredData = useMemo(() => {
    if (!data) return [];
    if (!searchFilter) return data;
    const q = searchFilter.toLowerCase();
    return data.filter((entry) => entry.displayName.toLowerCase().includes(q));
  }, [data, searchFilter]);

  const columns = useMemo(() => allTimeColumns(onViewRides), [onViewRides]);
  const table = useDataTable({
    data: filteredData,
    columns,
    sort: sortBy,
    dir: sortDir,
    onSortChange,
    sortClientSide: true,
    getRowId: (r) => r.userId,
  });

  return (
    <div className="alltime-table">
      <DataTable
        table={table}
        ariaLabel={`All-time rolling window leaderboard (${durationLabel})`}
        className="alltime-table__wrapper"
        isLoading={isLoading}
        error={error}
        empty={
          <TableEmpty icon="🏆" title="No riders found">
            No riders match the current filters.
          </TableEmpty>
        }
      />
    </div>
  );
}
