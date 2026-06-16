import { useRef, useState, useEffect, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "@tanstack/react-router";
import type { RouteCategory } from "../lib/database.types";
import { useUnit } from "../lib/useUnit";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
} from "../lib/leaderboard-utils";
import type { UnitSystem } from "./UnitToggle";

export type RouteSpeedEntry = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  route_category: RouteCategory;
  route_ride_count: number;
  avg_speed_mps: number;
  median_speed_mps: number;
  max_speed_mps: number;
  avg_distance_meters: number;
  avg_elevation_meters: number;
  last_ride_date: string | null;
};

interface RouteSpeedTableProps {
  data: RouteSpeedEntry[];
  searchFilter: string;
  riderColorMap: Map<string, string>;
  onViewRides: (userId: string, routeCategory?: RouteCategory) => void;
  onVisibleRidersChange: (riderIds: string[]) => void;
}

const columnHelper = createColumnHelper<RouteSpeedEntry>();

function getRouteSpeedColumns(unit: UnitSystem) {
  return [
    columnHelper.display({
      id: "rank",
      header: "#",
      cell: (info) => (
        <span className="leaderboard__rank">{info.row.index + 1}</span>
      ),
      size: 48,
    }),
    columnHelper.accessor("avatar_url", {
      header: "",
      cell: (info) => {
        const url = info.getValue();
        return url ? (
          <img
            src={url}
            alt=""
            className="leaderboard__rider-avatar"
            loading="lazy"
          />
        ) : (
          <div
            className="leaderboard__rider-avatar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--color-surface-hover)",
              fontSize: "14px",
            }}
          >
            👤
          </div>
        );
      },
      size: 48,
      enableSorting: false,
    }),
    columnHelper.accessor("display_name", {
      header: "Rider",
      cell: (info) => {
        const row = info.row.original;
        return (
          <Link
            to="/profile/$userId"
            params={{ userId: row.user_id }}
            className="leaderboard__rider-name"
          >
            {info.getValue() ?? row.username ?? "Anonymous"}
          </Link>
        );
      },
      size: 180,
    }),
    columnHelper.accessor("route_ride_count", {
      header: "Rides",
      cell: (info) => (
        <button
          className="leaderboard__count-btn"
          onClick={(e) => {
            e.stopPropagation();
            info.table.options.meta?.onViewRides?.(
              info.row.original.user_id,
              info.row.original.route_category,
            );
          }}
          type="button"
        >
          {info.getValue()}
        </button>
      ),
      size: 80,
    }),
    columnHelper.accessor("avg_speed_mps", {
      header: "Avg Speed",
      cell: (info) => (
        <span className="leaderboard__route-count">
          {formatSpeed(info.getValue(), unit)}
        </span>
      ),
      size: 110,
    }),
    columnHelper.accessor("median_speed_mps", {
      header: "Med Speed",
      cell: (info) => (
        <span className="leaderboard__route-count">
          {formatSpeed(info.getValue(), unit)}
        </span>
      ),
      size: 110,
    }),
    columnHelper.accessor("max_speed_mps", {
      header: "Max Speed",
      cell: (info) => (
        <span className="leaderboard__route-count">
          {formatSpeed(info.getValue(), unit)}
        </span>
      ),
      size: 110,
    }),
    columnHelper.accessor("avg_distance_meters", {
      header: "Avg Distance",
      cell: (info) => <span>{formatDistance(info.getValue(), unit)}</span>,
      size: 120,
    }),
    columnHelper.accessor("avg_elevation_meters", {
      header: "Avg Elevation",
      cell: (info) => <span>{formatElevation(info.getValue(), unit)}</span>,
      size: 130,
    }),
  ];
}

/**
 * RouteSpeedTable — virtualized table for the "Fastest by Route" leaderboard mode.
 * Same virtualization pattern as LeaderboardTable using TanStack Table + TanStack Virtual.
 */
export function RouteSpeedTable({
  data,
  searchFilter,
  riderColorMap,
  onViewRides,
  onVisibleRidersChange,
}: RouteSpeedTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "avg_speed_mps", desc: true },
  ]);

  const unit = useUnit();
  const columns = useMemo(() => getRouteSpeedColumns(unit), [unit]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: searchFilter,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const name = row.original.display_name ?? row.original.username ?? "";
      return name.toLowerCase().includes(filterValue.toLowerCase());
    },
    meta: {
      onViewRides,
    },
  });

  const { rows } = table.getRowModel();

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  // Track visible riders and report changes
  const prevFirstVisibleRef = useRef(-1);
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (virtualItems.length === 0) return;
    const firstIdx = virtualItems[0].index;
    if (firstIdx === prevFirstVisibleRef.current) return;
    prevFirstVisibleRef.current = firstIdx;
    const visibleIds = virtualItems
      .map((item) => rows[item.index]?.original.user_id)
      .filter(Boolean);
    onVisibleRidersChange(visibleIds);
  }, [virtualItems, rows, onVisibleRidersChange]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🔍</div>
        <h3 className="empty-state__title">No riders found</h3>
        <p className="empty-state__description">
          {searchFilter
            ? "Try a different search term."
            : "No speed data available for this route."}
        </p>
      </div>
    );
  }

  return (
    <div className="leaderboard__table-wrapper">
      <div ref={parentRef} style={{ maxHeight: "600px", overflow: "auto" }}>
        <table
          className="leaderboard__table"
          style={{ width: table.getTotalSize() }}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={
                      header.column.getIsSorted()
                        ? "leaderboard__table th--sorted"
                        : ""
                    }
                    style={{
                      width: header.getSize(),
                      cursor: header.column.getCanSort()
                        ? "pointer"
                        : "default",
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {header.column.getIsSorted() && (
                      <span className="sort-indicator">
                        {header.column.getIsSorted() === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={`column-resizer${header.column.getIsResizing() ? " column-resizer--resizing" : ""}`}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {/* Top spacer — pushes visible rows to the correct scroll offset */}
            {virtualItems.length > 0 && virtualItems[0].start > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={9999}
                  style={{
                    height: `${virtualItems[0].start}px`,
                    padding: 0,
                    border: "none",
                  }}
                />
              </tr>
            )}
            {virtualItems.length > 0 &&
              virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const color = riderColorMap.get(row.original.user_id);
                return (
                  <tr
                    key={row.id}
                    style={{
                      height: `${virtualRow.size}px`,
                      borderLeft: color ? `3px solid ${color}` : undefined,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            {/* Bottom spacer — fills remaining space so scrollbar is accurate */}
            {virtualItems.length > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={9999}
                  style={{
                    height: `${virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end}px`,
                    padding: 0,
                    border: "none",
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
