import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { AllTimeEntry } from "../server/alltime";
import { formatRideDate } from "../lib/leaderboard-utils";
import { useColumnResize } from "../lib/useColumnResize";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface AllTimeTableProps {
  data: AllTimeEntry[] | undefined;
  isLoading: boolean;
  searchFilter: string;
  durationLabel: string;
  pprActive?: boolean;
  pprDawnRiderIds?: string[];
  onViewRides?: (userId: string, dateFrom: string, dateTo: string) => void;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  tooltip: string;
  className?: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    tooltip: "Rank by max rides in window",
    className: "alltime-table__rank",
  },
  {
    key: "displayName",
    label: "Rider",
    sortable: true,
    tooltip: "Rider name — click to sort by name or view their profile",
  },
  {
    key: "maxRidesInWindow",
    label: "Max Rides",
    sortable: true,
    tooltip:
      "Maximum number of SF2G rides completed within the rolling window — click to view rides",
  },
  {
    key: "windowStart",
    label: "Window Start",
    sortable: true,
    tooltip: "Start date of the best rolling window",
  },
  {
    key: "windowEnd",
    label: "Window End",
    sortable: true,
    tooltip: "End date of the best rolling window",
  },
];

const SKELETON_ROWS = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AllTimeTable({
  data,
  isLoading,
  searchFilter,
  durationLabel,
  pprActive,
  pprDawnRiderIds,
  onViewRides,
}: AllTimeTableProps) {
  const tableRef = useColumnResize<HTMLTableElement>();
  const [sortKey, setSortKey] = useState("maxRidesInWindow");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Client-side search + PPR filtering
  const filteredData = useMemo(() => {
    if (!data) return [];
    let result = data;
    // PPR filter: only show riders with qualifying PPR rides
    if (pprActive && pprDawnRiderIds) {
      const pprSet = new Set(pprDawnRiderIds);
      result = result.filter((entry) => pprSet.has(entry.userId));
    }
    if (!searchFilter) return result;
    const q = searchFilter.toLowerCase();
    return result.filter((entry) =>
      entry.displayName.toLowerCase().includes(q),
    );
  }, [data, searchFilter, pprActive, pprDawnRiderIds]);

  // Client-side sorting
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      const aVal = a[sortKey as keyof AllTimeEntry] ?? 0;
      const bVal = b[sortKey as keyof AllTimeEntry] ?? 0;
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredData, sortKey, sortDir]);

  const handleSort = (col: ColumnDef) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  };

  const ariaSortValue = (
    col: ColumnDef,
  ): "ascending" | "descending" | "none" => {
    if (sortKey !== col.key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="alltime-table">
      <div className="alltime-table__wrapper">
        <table
          ref={tableRef}
          role="grid"
          aria-label="All-time rolling window leaderboard"
        >
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.className}
                  aria-sort={col.sortable ? ariaSortValue(col) : undefined}
                  onClick={() => handleSort(col)}
                  title={col.tooltip}
                  style={
                    col.sortable ? { cursor: "pointer" } : { cursor: "help" }
                  }
                >
                  {col.label}
                  {col.sortable && (
                    <span
                      className={`sort-indicator${sortKey === col.key ? "" : " sort-indicator--placeholder"}`}
                    >
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="alltime-table__empty">
                  No riders match the current filters
                </td>
              </tr>
            ) : (
              sortedData.map((entry, idx) => (
                <AllTimeRow
                  key={entry.userId}
                  entry={entry}
                  rank={idx + 1}
                  onViewRides={onViewRides}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------
function AllTimeRow({
  entry,
  rank,
  onViewRides,
}: {
  entry: AllTimeEntry;
  rank: number;
  onViewRides?: (userId: string, dateFrom: string, dateTo: string) => void;
}) {
  return (
    <tr>
      {/* Rank */}
      <td className="alltime-table__rank">{rank}</td>

      {/* Rider */}
      <td>
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
      </td>

      {/* Max Rides — clickable to navigate to rides view */}
      <td className="alltime-table__max-rides">
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
      </td>

      {/* Window Start */}
      <td>{formatRideDate(entry.windowStart) ?? "—"}</td>

      {/* Window End */}
      <td>{formatRideDate(entry.windowEnd) ?? "—"}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading rows
// ---------------------------------------------------------------------------
function SkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <tr key={`skel-${i}`} className="alltime-table__skeleton-row">
          {COLUMNS.map((col) => (
            <td key={col.key}>
              <div className="alltime-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
