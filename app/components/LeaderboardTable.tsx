import { useMemo, useCallback } from "react";
import type { LeaderboardEntry, RouteCategory } from "../lib/database.types";
import { getLeaderboardColumns, type TableDensity } from "./LeaderboardColumns";
import { useUnit } from "../lib/useUnit";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";

interface LeaderboardTableProps {
  /** Rows as returned by get_leaderboard (already filtered and sorted). */
  data: LeaderboardEntry[];
  searchFilter: string;
  riderColorMap: Map<string, string>;
  onViewRides: (userId: string, routeCategory?: RouteCategory) => void;
  sortBy: string;
  sortDir: SortDir;
  onSortChange: (column: string, direction: SortDir) => void;
  density: TableDensity;
  isAllTime?: boolean;
  includeOther?: boolean;
  chartOpen?: boolean;
  selectedRiderIds?: Set<string>;
  onToggleRider?: (userId: string) => void;
  onSelectAllRiders?: () => void;
  onDeselectAllRiders?: () => void;
  isLoading?: boolean;
  error?: Error | null;
}

/**
 * Riders leaderboard — server-sorted, virtualized (DataTable).
 * With the growth chart open, a leading column toggles riders on the chart.
 */
export function LeaderboardTable({
  data,
  searchFilter,
  riderColorMap,
  onViewRides,
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
  isLoading,
  error,
}: LeaderboardTableProps) {
  const unit = useUnit();
  const columns = useMemo(
    () => getLeaderboardColumns(unit, density, isAllTime, includeOther),
    [unit, density, isAllTime, includeOther],
  );

  const table = useDataTable({
    data,
    columns,
    sort: sortBy,
    dir: sortDir,
    onSortChange,
    getRowId: (r, i) => r.user_id ?? String(i),
    meta: { onViewRides },
  });

  const isSelected = (id: string | null) => !!id && !!selectedRiderIds?.has(id);
  const allSelected =
    data.length > 0 && data.every((r) => isSelected(r.user_id));
  const someSelected = data.some((r) => isSelected(r.user_id));

  const handleHeaderCheckbox = useCallback(() => {
    if (allSelected) onDeselectAllRiders?.();
    else onSelectAllRiders?.();
  }, [allSelected, onDeselectAllRiders, onSelectAllRiders]);

  return (
    <DataTable
      table={table}
      ariaLabel="Riders leaderboard"
      className="leaderboard__table-wrapper"
      tableClassName="leaderboard__table"
      virtualize
      rowHeight={48}
      isLoading={isLoading}
      error={error}
      empty={
        <TableEmpty title="No riders found">
          {searchFilter
            ? "Try a different search term."
            : "No riders have synced their data yet."}
        </TableEmpty>
      }
      getRowProps={(row) => {
        const color = riderColorMap.get(row.original.user_id ?? "");
        return {
          style: color ? { borderLeft: `3px solid ${color}` } : undefined,
        };
      }}
      leadingHeader={
        chartOpen ? (
          <th
            className="leaderboard__chart-select-header"
            title={allSelected ? "Deselect all riders" : "Select all riders"}
          >
            <button
              type="button"
              className={`leaderboard__chart-toggle ${allSelected ? "leaderboard__chart-toggle--all" : someSelected ? "leaderboard__chart-toggle--some" : ""}`}
              onClick={handleHeaderCheckbox}
              aria-label={
                allSelected
                  ? "Deselect all riders from chart"
                  : "Select all riders for chart"
              }
            />
          </th>
        ) : undefined
      }
      renderLeadingCell={
        chartOpen
          ? (row) => {
              const id = row.original.user_id ?? "";
              const selected = isSelected(id);
              const color = riderColorMap.get(id);
              return (
                <td className="leaderboard__chart-select-cell">
                  <button
                    type="button"
                    className={`leaderboard__chart-toggle ${selected ? "leaderboard__chart-toggle--active" : ""}`}
                    style={
                      selected && color
                        ? { background: color, borderColor: color }
                        : undefined
                    }
                    onClick={() => onToggleRider?.(id)}
                    aria-label={`${selected ? "Remove" : "Add"} ${row.original.display_name ?? "rider"} ${selected ? "from" : "to"} chart`}
                  />
                </td>
              );
            }
          : undefined
      }
    />
  );
}
