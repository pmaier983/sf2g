import { useRef, useEffect, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LeaderboardEntry, RouteCategory } from "../lib/database.types";
import { getLeaderboardColumns, type TableDensity } from "./LeaderboardColumns";
import { useUnit } from "../lib/useUnit";

interface LeaderboardTableProps {
  data: LeaderboardEntry[];
  searchFilter: string;
  riderColorMap: Map<string, string>;
  onViewRides: (userId: string, routeCategory?: RouteCategory) => void;
  onVisibleRidersChange: (riderIds: string[]) => void;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  density: TableDensity;
  isAllTime?: boolean;
  includeOther?: boolean;
  chartOpen?: boolean;
  selectedRiderIds?: Set<string>;
  onToggleRider?: (userId: string) => void;
  onSelectAllRiders?: () => void;
  onDeselectAllRiders?: () => void;
}

/**
 * LeaderboardTable — virtualized table using TanStack Table + TanStack Virtual.
 * Renders only visible rows for performance.
 * Sorting is server-side — this component does NOT re-sort data locally.
 */
export function LeaderboardTable({
  data,
  searchFilter,
  riderColorMap,
  onViewRides,
  onVisibleRidersChange,
  sortBy,
  sortDir,
  onSortChange,
  density,
  isAllTime,
  includeOther,
  chartOpen,
  selectedRiderIds,
  onToggleRider,
  onSelectAllRiders,
  onDeselectAllRiders,
}: LeaderboardTableProps) {
  const unit = useUnit();
  const columns = useMemo(
    () => getLeaderboardColumns(unit, density, isAllTime, includeOther),
    [unit, density, isAllTime, includeOther],
  );
  // Derive sorting state from props (visual indicator only)
  const sorting: SortingState = [{ id: sortBy, desc: sortDir === "desc" }];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: searchFilter,
    },
    onSortingChange: (updater) => {
      // Intercept sort changes and delegate to parent via onSortChange.
      // TanStack Table's default toggle cycles asc → desc → false (unsorted).
      // We override: same column = flip direction, different column = start desc.
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      if (newSorting.length > 0) {
        const col = newSorting[0];
        // If the user clicked the same column that is already sorted,
        // simply flip the direction (TanStack may have cycled to unsorted)
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
    getFilteredRowModel: getFilteredRowModel(),
    // No getSortedRowModel — data comes pre-sorted from server
    manualSorting: true,
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
      .filter((id): id is string => id != null);
    onVisibleRidersChange(visibleIds);
  }, [virtualItems, rows, onVisibleRidersChange]);

  // Handler for header checkbox
  const allSelected = useMemo(() => {
    if (!selectedRiderIds || rows.length === 0) return false;
    return rows.every((row) =>
      selectedRiderIds.has(row.original.user_id ?? ""),
    );
  }, [selectedRiderIds, rows]);

  const someSelected = useMemo(() => {
    if (!selectedRiderIds || rows.length === 0) return false;
    return rows.some((row) => selectedRiderIds.has(row.original.user_id ?? ""));
  }, [selectedRiderIds, rows]);

  const handleHeaderCheckbox = useCallback(() => {
    if (allSelected) {
      onDeselectAllRiders?.();
    } else {
      onSelectAllRiders?.();
    }
  }, [allSelected, onDeselectAllRiders, onSelectAllRiders]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">🔍</div>
        <h3 className="empty-state__title">No riders found</h3>
        <p className="empty-state__description">
          {searchFilter
            ? "Try a different search term."
            : "No riders have synced their data yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="leaderboard__table-wrapper" aria-label="Riders leaderboard">
      <div ref={parentRef} style={{ flex: 1, overflow: "auto" }}>
        <table className="leaderboard__table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {chartOpen && (
                  <th
                    className="leaderboard__chart-select-header"
                    onClick={handleHeaderCheckbox}
                    title={
                      allSelected ? "Deselect all riders" : "Select all riders"
                    }
                  >
                    <button
                      type="button"
                      className={`leaderboard__chart-toggle ${allSelected ? "leaderboard__chart-toggle--all" : someSelected ? "leaderboard__chart-toggle--some" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHeaderCheckbox();
                      }}
                      aria-label={
                        allSelected
                          ? "Deselect all riders from chart"
                          : "Select all riders for chart"
                      }
                    />
                  </th>
                )}
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
                    </th>
                  );
                })}
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
                const color = riderColorMap.get(row.original.user_id ?? "");
                return (
                  <tr
                    key={row.id}
                    style={{
                      height: `${virtualRow.size}px`,
                      borderLeft: color ? `3px solid ${color}` : undefined,
                    }}
                  >
                    {chartOpen && (
                      <td className="leaderboard__chart-select-cell">
                        <button
                          type="button"
                          className={`leaderboard__chart-toggle ${selectedRiderIds?.has(row.original.user_id ?? "") ? "leaderboard__chart-toggle--active" : ""}`}
                          style={
                            selectedRiderIds?.has(row.original.user_id ?? "") &&
                            color
                              ? { background: color, borderColor: color }
                              : undefined
                          }
                          onClick={() =>
                            onToggleRider?.(row.original.user_id ?? "")
                          }
                          aria-label={`${selectedRiderIds?.has(row.original.user_id ?? "") ? "Remove" : "Add"} ${row.original.display_name ?? "rider"} ${selectedRiderIds?.has(row.original.user_id ?? "") ? "from" : "to"} chart`}
                        />
                      </td>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
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
