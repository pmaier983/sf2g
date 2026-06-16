import { useMemo, useRef, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  flexRender,
  type SortingState,
} from "@tanstack/react-table";
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
      sortingFn: (a, b) => {
        const da = new Date(a.original.date).getTime();
        const db = new Date(b.original.date).getTime();
        return da - db;
      },
      size: 120,
    }),

    columnHelper.accessor("routeCategory", {
      id: "routeCategory",
      header: "Route",
      cell: (info) => <RouteTag category={info.getValue()} />,
      enableSorting: false,
      size: 96,
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
      size: 80,
      sortDescFirst: true,
    }),

    columnHelper.accessor("avgSpeedMps", {
      header: "Avg Speed",
      cell: (info) => formatSpeed(info.getValue(), unit),
      size: 100,
      sortDescFirst: true,
    }),

    columnHelper.accessor("avgWatts", {
      header: "Avg Watts",
      cell: (info) => {
        const val = info.getValue();
        if (val == null)
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
        return Math.round(val);
      },
      size: 96,
      sortDescFirst: true,
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
      size: 80,
      sortDescFirst: true,
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
      size: 96,
      sortDescFirst: true,
      sortUndefined: "last",
    }),

    columnHelper.accessor("maxSpeedMps", {
      header: "Max Speed",
      cell: (info) => formatSpeed(info.getValue(), unit),
      size: 100,
      sortDescFirst: true,
    }),

    columnHelper.accessor(
      (row) =>
        row.riderCount > 0 ? row.totalDistanceMeters / row.riderCount : 0,
      {
        id: "avgDistance",
        header: "Distance",
        cell: (info) => formatDistance(info.getValue(), unit),
        size: 100,
        sortDescFirst: true,
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * GroupRidesTable — TanStack Table component for displaying group rides.
 * Uses client-side sorting with overlapping avatar circles and unit-aware formatting.
 */
export function GroupRidesTable({
  data,
  isLoading,
  onGroupRideClick,
  sortBy,
  sortDir,
  onSortChange,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: GroupRidesTableProps) {
  const loadMoreRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    const el = loadMoreRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, [hasNextPage, fetchNextPage]);

  const unit = useUnit();
  const columns = useMemo(() => getGroupRideColumns(unit), [unit]);

  // Derive sorting state from props
  const sorting: SortingState = [{ id: sortBy, desc: sortDir === "desc" }];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
    },
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      if (newSorting.length > 0) {
        const col = newSorting[0];
        if (col.id === sortBy) {
          onSortChange(col.id, sortDir === "desc" ? "asc" : "desc");
        } else {
          onSortChange(col.id, col.desc ? "desc" : "asc");
        }
      } else {
        // TanStack Table cleared sorting (3rd click) — treat as flip instead
        onSortChange(sortBy, sortDir === "desc" ? "asc" : "desc");
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    columnResizeMode: "onChange",
  });

  const { rows } = table.getRowModel();

  if (!isLoading && data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🚴</div>
        <h3 className="empty-state__title">No group rides found</h3>
        <p className="empty-state__description">
          No group rides match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="group-rides-table__wrapper" aria-label="Group rides">
      <table className="group-rides-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={sorted ? "th--sorted" : ""}
                    style={{
                      cursor: canSort ? "pointer" : "default",
                      width: header.getSize(),
                    }}
                    aria-sort={
                      canSort
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {canSort && (
                      <span
                        className={`sort-indicator${sorted ? "" : " sort-indicator--placeholder"}`}
                      >
                        {sorted === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={`column-resizer${header.column.getIsResizing() ? " column-resizer--resizing" : ""}`}
                    />
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            <GroupRideSkeletonRows columnCount={columns.length} />
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onGroupRideClick(row.original)}
                style={{ cursor: "pointer" }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
          {hasNextPage && (
            <tr ref={loadMoreRef}>
              <td
                colSpan={columns.length}
                style={{ textAlign: "center", padding: "1rem" }}
              >
                {isFetchingNextPage ? (
                  <div className="group-rides-table__skeleton" />
                ) : (
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Loading more…
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading rows
// ---------------------------------------------------------------------------

const SKELETON_ROW_COUNT = 8;

function GroupRideSkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
        <tr key={`skel-${i}`} className="group-rides-table__skeleton-row">
          {Array.from({ length: columnCount }, (_, j) => (
            <td key={`skel-${i}-${j}`}>
              <div className="group-rides-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
