import { useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import type { Ride, RouteCategory } from "../lib/database.types";
import { ROUTE_LABELS } from "../lib/constants";
import { fetchUserRides } from "../server/rides";
import { useUnit } from "../lib/useUnit";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
} from "../lib/leaderboard-utils";
import type { UnitSystem } from "./UnitToggle";

interface RideSubTableProps {
  userId: string;
  routeCategory?: RouteCategory;
  riderName: string;
  onClose: () => void;
}

const columnHelper = createColumnHelper<Ride>();

/**
 * Format seconds into "H:MM" or "M:SS" format.
 */
function formatMovingTime(seconds: number | null): string {
  if (seconds == null || seconds === 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getRideColumns(unit: UnitSystem) {
  return [
    columnHelper.accessor("ride_date", {
      header: "Date",
      cell: (info) => {
        const date = info.getValue();
        return new Date(date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
      },
      size: 120,
    }),
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => {
        const ride = info.row.original;
        const name = info.getValue() ?? "Untitled Ride";
        return ride.strava_activity_id ? (
          <a
            href={`https://www.strava.com/activities/${String(ride.strava_activity_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-rides__strava-link"
          >
            {name}
          </a>
        ) : (
          name
        );
      },
      size: 200,
    }),
    columnHelper.accessor("average_speed_mps", {
      header: "Avg Speed",
      cell: (info) => {
        const mps = info.getValue();
        if (mps == null) return "—";
        return formatSpeed(mps, unit);
      },
      size: 110,
    }),
    columnHelper.accessor("distance_meters", {
      header: "Distance",
      cell: (info) => {
        const meters = info.getValue();
        if (meters == null) return "—";
        return formatDistance(meters, unit);
      },
      size: 110,
    }),
    columnHelper.accessor("elevation_gain_meters", {
      header: "Elevation",
      cell: (info) => {
        const meters = info.getValue();
        if (meters == null) return "—";
        return formatElevation(meters, unit);
      },
      size: 110,
    }),
    columnHelper.accessor("moving_time_seconds", {
      header: "Moving Time",
      cell: (info) => formatMovingTime(info.getValue()),
      size: 120,
    }),
  ];
}

/**
 * RideSubTable — inline expandable ride list shown below a leaderboard row.
 * Uses TanStack Table (NOT virtualized — small dataset).
 */
export function RideSubTable({
  userId,
  routeCategory,
  riderName,
  onClose,
}: RideSubTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "ride_date", desc: true },
  ]);

  const { data: rides, isLoading } = useQuery({
    queryKey: ["rides", userId, routeCategory ?? "all"],
    queryFn: () =>
      fetchUserRides({
        data: { userId, routeCategory, limit: 200 },
      }),
    staleTime: 120_000,
  });

  const safeRides = useMemo(() => rides ?? [], [rides]);

  const unit = useUnit();
  const columns = useMemo(() => getRideColumns(unit), [unit]);
  const isResizingRef = useRef(false);

  const table = useReactTable({
    data: safeRides,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange",
  });

  const routeTag = routeCategory ? ROUTE_LABELS[routeCategory] : null;

  return (
    <div className="leaderboard__sub-table surface-card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <span
            style={{
              fontWeight: "var(--font-bold)",
              color: "var(--color-text)",
            }}
          >
            ▼ {riderName}&apos;s Rides
          </span>
          {!isLoading && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              ({safeRides.length})
            </span>
          )}
          {routeTag && (
            <span
              className="badge"
              style={{
                background: `var(--color-${routeCategory}-bg)`,
                color: `var(--color-${routeCategory})`,
              }}
            >
              {routeTag}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "var(--text-lg)",
            color: "var(--color-text-muted)",
            lineHeight: 1,
            padding: "4px",
          }}
          aria-label="Close ride details"
        >
          ×
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: "var(--space-5)", textAlign: "center" }}>
          <div
            className="skeleton"
            style={{
              height: "1rem",
              width: "60%",
              margin: "0 auto var(--space-2)",
            }}
          />
          <div
            className="skeleton"
            style={{
              height: "1rem",
              width: "80%",
              margin: "0 auto var(--space-2)",
            }}
          />
          <div
            className="skeleton"
            style={{ height: "1rem", width: "40%", margin: "0 auto" }}
          />
        </div>
      ) : safeRides.length === 0 ? (
        <div
          style={{
            padding: "var(--space-5)",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
          No rides found{routeTag ? ` for ${routeTag}` : ""}.
        </div>
      ) : (
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
                    onClick={(e) => {
                      if (isResizingRef.current) return;
                      header.column.getToggleSortingHandler()?.(e);
                    }}
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
                      onMouseDown={(e) => {
                        isResizingRef.current = true;
                        header.getResizeHandler()(e);
                        const onUp = () => {
                          setTimeout(() => {
                            isResizingRef.current = false;
                          }, 200);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mouseup", onUp);
                      }}
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
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
