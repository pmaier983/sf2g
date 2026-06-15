import { useState, useMemo } from "react";
import type { GroupRideDetailRider } from "../server/group-rides";
import { useUnit } from "../lib/useUnit";
import {
  formatSpeed,
  formatDistance,
  formatElevation,
} from "../lib/leaderboard-utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GroupRideComparisonTableProps {
  riders: GroupRideDetailRider[];
  riderColors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatWatts(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)} W`;
}

function formatHr(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value)} bpm`;
}

function formatTailwind(value: number | null): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} m/s`;
}

function formatCalories(kj: number | null): string {
  if (kj == null) return "—";
  return `${Math.round(kj)} kJ`;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

type SortColumn =
  | "rider"
  | "time"
  | "avgSpeed"
  | "maxSpeed"
  | "avgWatts"
  | "maxWatts"
  | "avgHr"
  | "maxHr"
  | "distance"
  | "elevation"
  | "tailwind"
  | "calories";

interface ColumnDef {
  key: SortColumn;
  label: string;
  /** Extract a sortable numeric value. null means "no data". */
  getValue: (r: GroupRideDetailRider) => number | null;
  /** Lower-is-better columns (e.g. time). Default is higher-is-better. */
  lowerIsBetter?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupRideComparisonTable({
  riders,
  riderColors,
}: GroupRideComparisonTableProps) {
  const unit = useUnit();

  const [sortColumn, setSortColumn] = useState<SortColumn>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Column definitions with accessor + sort semantics
  const columns: ColumnDef[] = useMemo(
    () => [
      {
        key: "time",
        label: "Time",
        getValue: (r) => r.ride.moving_time_seconds,
        lowerIsBetter: true,
      },
      {
        key: "avgSpeed",
        label: "Avg Speed",
        getValue: (r) => r.ride.average_speed_mps,
      },
      {
        key: "maxSpeed",
        label: "Max Speed",
        getValue: (r) => r.ride.max_speed_mps,
      },
      {
        key: "avgWatts",
        label: "Avg Watts",
        getValue: (r) => r.ride.average_watts,
      },
      {
        key: "maxWatts",
        label: "Max Watts",
        getValue: (r) => r.ride.max_watts,
      },
      {
        key: "avgHr",
        label: "Avg HR",
        getValue: (r) => r.ride.average_heartrate,
      },
      {
        key: "maxHr",
        label: "Max HR",
        getValue: (r) => r.ride.max_heartrate,
      },
      {
        key: "distance",
        label: "Distance",
        getValue: (r) => r.ride.distance_meters,
      },
      {
        key: "elevation",
        label: "Elevation",
        getValue: (r) => r.ride.elevation_gain_meters,
      },
      {
        key: "tailwind",
        label: "Tailwind",
        getValue: (r) => r.ride.tailwind_component_ms,
      },
      {
        key: "calories",
        label: "Calories",
        getValue: (r) => r.ride.kilojoules,
      },
    ],
    [],
  );

  // Compute the best (highlighted) value per column
  const bestByColumn = useMemo(() => {
    const best = new Map<SortColumn, number>();
    for (const col of columns) {
      const values = riders
        .map((r) => col.getValue(r))
        .filter((v): v is number => v != null);
      if (values.length === 0) continue;
      best.set(
        col.key,
        col.lowerIsBetter ? Math.min(...values) : Math.max(...values),
      );
    }
    return best;
  }, [riders, columns]);

  // Sort riders
  const sortedRiders = useMemo(() => {
    // Keep parallel rider/color mapping by sorting indices
    const indices = riders.map((_, i) => i);

    if (sortColumn === "rider") {
      indices.sort((a, b) => {
        const nameA = riders[a].displayName.toLowerCase();
        const nameB = riders[b].displayName.toLowerCase();
        return sortDir === "asc"
          ? nameA.localeCompare(nameB)
          : nameB.localeCompare(nameA);
      });
    } else {
      const col = columns.find((c) => c.key === sortColumn);
      if (col) {
        indices.sort((a, b) => {
          const va = col.getValue(riders[a]);
          const vb = col.getValue(riders[b]);
          // Push nulls to the bottom regardless of direction
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return sortDir === "asc" ? va - vb : vb - va;
        });
      }
    }

    return indices.map((i) => ({ rider: riders[i], color: riderColors[i] }));
  }, [riders, riderColors, sortColumn, sortDir, columns]);

  // Handle column header click
  const handleSort = (col: SortColumn) => {
    if (col === sortColumn) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      // Default sort direction: asc for time (lower is better), desc for others
      const def = columns.find((c) => c.key === col);
      setSortDir(def?.lowerIsBetter ? "asc" : "desc");
    }
  };

  // Format a cell value for display
  const formatCell = (col: ColumnDef, rider: GroupRideDetailRider): string => {
    const val = col.getValue(rider);
    switch (col.key) {
      case "avgSpeed":
      case "maxSpeed":
        return val != null ? formatSpeed(val, unit) : "—";
      case "avgWatts":
      case "maxWatts":
        return formatWatts(val);
      case "avgHr":
      case "maxHr":
        return formatHr(val);
      case "distance":
        return val != null ? formatDistance(val, unit) : "—";
      case "elevation":
        return val != null ? formatElevation(val, unit) : "—";
      case "tailwind":
        return formatTailwind(val);
      case "calories":
        return formatCalories(val);
      default:
        return val != null ? String(val) : "—";
    }
  };

  // Check if a value is the best for its column
  const isBest = (col: ColumnDef, rider: GroupRideDetailRider): boolean => {
    const val = col.getValue(rider);
    if (val == null) return false;
    return val === bestByColumn.get(col.key);
  };

  const sortIndicator = (col: SortColumn) => {
    if (col !== sortColumn) return null;
    return (
      <span className="group-ride-comparison__sort-indicator">
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  if (riders.length === 0) return null;

  return (
    <div className="group-ride-comparison">
      <div className="group-ride-comparison__scroll">
        <table className="group-ride-comparison__table">
          <thead>
            <tr>
              <th
                className={`group-ride-comparison__th group-ride-comparison__th--sticky${sortColumn === "rider" ? " group-ride-comparison__th--sorted" : ""}`}
                onClick={() => handleSort("rider")}
              >
                Rider
                {sortIndicator("rider")}
                {sortColumn !== "rider" && (
                  <span className="group-ride-comparison__sort-indicator group-ride-comparison__sort-indicator--placeholder">
                    ▼
                  </span>
                )}
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`group-ride-comparison__th${sortColumn === col.key ? " group-ride-comparison__th--sorted" : ""}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortIndicator(col.key)}
                  {sortColumn !== col.key && (
                    <span className="group-ride-comparison__sort-indicator group-ride-comparison__sort-indicator--placeholder">
                      ▼
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRiders.map(({ rider, color }) => (
              <tr key={rider.userId} className="group-ride-comparison__row">
                <td className="group-ride-comparison__td group-ride-comparison__td--sticky group-ride-comparison__rider-cell">
                  <span
                    className="group-ride-comparison__avatar"
                    style={{
                      borderColor: color,
                      backgroundImage: rider.avatarUrl
                        ? `url(${rider.avatarUrl})`
                        : undefined,
                    }}
                  />
                  <span className="group-ride-comparison__rider-name">
                    {rider.displayName}
                  </span>
                </td>
                {columns.map((col) => {
                  const best = isBest(col, rider);
                  return (
                    <td
                      key={col.key}
                      className={`group-ride-comparison__td${best ? " group-ride-comparison__td--best" : ""}`}
                    >
                      {col.key === "time" ? (
                        <a
                          href={`https://www.strava.com/activities/${rider.ride.strava_activity_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group-ride-comparison__strava-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {formatTime(col.getValue(rider))}
                        </a>
                      ) : (
                        formatCell(col, rider)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
