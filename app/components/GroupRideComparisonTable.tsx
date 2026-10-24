import { useState, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { GroupRideDetailRider } from "../server/group-rides";
import { useUnit } from "../lib/useUnit";
import {
  formatSpeed,
  formatDistance,
  formatElevation,
} from "../lib/leaderboard-utils";
import { DataTable } from "./table/DataTable";
import { useDataTable, type SortDir } from "./table/useDataTable";

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

function formatCalories(kj: number | null): string {
  if (kj == null) return "—";
  return `${Math.round(kj)} kJ`;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

interface ComparisonRow {
  rider: GroupRideDetailRider;
  color: string;
}

interface Metric {
  id: string;
  label: string;
  get: (r: GroupRideDetailRider) => number | null;
  format: (v: number | null) => string;
  /** Lower is better (time): highlighted as best and sorted ascending first. */
  lowerIsBetter?: boolean;
}

function metrics(unit: ReturnType<typeof useUnit>): Metric[] {
  const orDash = (f: (v: number) => string) => (v: number | null) =>
    v != null ? f(v) : "—";
  return [
    {
      id: "time",
      label: "Time",
      get: (r) => r.ride.moving_time_seconds,
      format: formatTime,
      lowerIsBetter: true,
    },
    {
      id: "avgSpeed",
      label: "Avg Speed",
      get: (r) => r.ride.average_speed_mps,
      format: orDash((v) => formatSpeed(v, unit)),
    },
    {
      id: "maxSpeed",
      label: "Max Speed",
      get: (r) => r.ride.max_speed_mps,
      format: orDash((v) => formatSpeed(v, unit)),
    },
    {
      id: "avgWatts",
      label: "Avg Watts",
      get: (r) => r.ride.average_watts,
      format: formatWatts,
    },
    {
      id: "maxWatts",
      label: "Max Watts",
      get: (r) => r.ride.max_watts,
      format: formatWatts,
    },
    {
      id: "avgHr",
      label: "Avg HR",
      get: (r) => r.ride.average_heartrate,
      format: formatHr,
    },
    {
      id: "maxHr",
      label: "Max HR",
      get: (r) => r.ride.max_heartrate,
      format: formatHr,
    },
    {
      id: "distance",
      label: "Distance",
      get: (r) => r.ride.distance_meters,
      format: orDash((v) => formatDistance(v, unit)),
    },
    {
      id: "elevation",
      label: "Elevation",
      get: (r) => r.ride.elevation_gain_meters,
      format: orDash((v) => formatElevation(v, unit)),
    },
    {
      id: "calories",
      label: "Calories",
      get: (r) => r.ride.kilojoules,
      format: formatCalories,
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupRideComparisonTable({
  riders,
  riderColors,
}: GroupRideComparisonTableProps) {
  const unit = useUnit();
  const [sort, setSort] = useState<{ sort: string; dir: SortDir }>({
    sort: "time",
    dir: "asc",
  });

  const rows = useMemo<ComparisonRow[]>(
    () => riders.map((rider, i) => ({ rider, color: riderColors[i] })),
    [riders, riderColors],
  );
  const metricList = useMemo(() => metrics(unit), [unit]);

  // The best value per metric is highlighted.
  const best = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of metricList) {
      const values = riders.map(m.get).filter((v): v is number => v != null);
      if (values.length > 0)
        out.set(
          m.id,
          m.lowerIsBetter ? Math.min(...values) : Math.max(...values),
        );
    }
    return out;
  }, [riders, metricList]);

  const columns = useMemo<ColumnDef<ComparisonRow, any>[]>(
    () => [
      {
        id: "rider",
        accessorFn: (r) => r.rider.displayName,
        header: "Rider",
        meta: { defaultDir: "asc" },
        cell: ({ row: { original } }) => (
          <div className="group-ride-comparison__rider-cell">
            <span
              className="group-ride-comparison__avatar"
              style={{
                borderColor: original.color,
                backgroundImage: original.rider.avatarUrl
                  ? `url(${original.rider.avatarUrl})`
                  : undefined,
              }}
            />
            <span className="group-ride-comparison__rider-name">
              {original.rider.displayName}
            </span>
          </div>
        ),
      },
      ...metricList.map(
        (m): ColumnDef<ComparisonRow, any> => ({
          id: m.id,
          accessorFn: (r) => m.get(r.rider),
          header: m.label,
          size: 110,
          meta: { defaultDir: m.lowerIsBetter ? "asc" : "desc" },
          cell: ({ row: { original }, getValue }) =>
            m.id === "time" ? (
              <a
                href={`https://www.strava.com/activities/${original.rider.ride.strava_activity_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group-ride-comparison__strava-link"
                onClick={(e) => e.stopPropagation()}
              >
                {m.format(getValue())}
              </a>
            ) : (
              m.format(getValue())
            ),
        }),
      ),
    ],
    [metricList],
  );

  const table = useDataTable({
    data: rows,
    columns,
    sort: sort.sort,
    dir: sort.dir,
    onSortChange: (s, d) => setSort({ sort: s, dir: d }),
    sortClientSide: true,
    getRowId: (r) => r.rider.userId,
  });

  if (riders.length === 0) return null;

  return (
    <div className="group-ride-comparison">
      <DataTable
        table={table}
        ariaLabel="Rider comparison"
        className="group-ride-comparison__scroll"
        tableClassName="group-ride-comparison__table"
        getCellClassName={(cell) => {
          const v = cell.getValue();
          return v != null && v === best.get(cell.column.id)
            ? "group-ride-comparison__td--best"
            : undefined;
        }}
      />
    </div>
  );
}
