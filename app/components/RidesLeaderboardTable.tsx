import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RideLeaderboardEntry } from "../lib/database.types";
import { currentUserQueryOptions } from "../queries/user";
import { EditRideDialog } from "./EditRideDialog";
import type { EditRideData } from "./EditRideDialog";
import { Tooltip } from "./Tooltip";
import {
  formatSpeed,
  formatDistance,
  formatElevation,
  formatRideDate,
  formatMovingTime,
} from "../lib/leaderboard-utils";
import { msToMph } from "../lib/wind";
import { useUnit } from "../lib/useUnit";
import { RouteTag } from "./RouteTag";
import { useColumnResize } from "../lib/useColumnResize";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface RidesLeaderboardTableProps {
  rides: RideLeaderboardEntry[];
  totalCount: number;
  isLoading: boolean;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  activeUser?: string | null;
  onClearUser?: () => void;
}

// ---------------------------------------------------------------------------
// Sortable column definitions
// ---------------------------------------------------------------------------
interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  className?: string;
  tooltip: string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    className: "rides-table__rank",
    tooltip: "Row number in the current sort order",
  },
  {
    key: "display_name",
    label: "Rider",
    sortable: true,
    tooltip: "Rider name — click to sort by name or view their profile",
  },
  {
    key: "name",
    label: "Ride Name",
    sortable: true,
    tooltip: "Strava activity name — click header to sort alphabetically",
  },
  {
    key: "ride_date",
    label: "Date",
    sortable: true,
    tooltip: "Ride date — click header to sort by date",
  },
  {
    key: "route_category",
    label: "Route",
    sortable: true,
    tooltip: "Classified SF2G route corridor (Bayway, Skyline, HMBW, etc.)",
  },
  {
    key: "average_speed_mps",
    label: "Avg Speed",
    sortable: true,
    tooltip: "Average moving speed for the ride",
  },
  {
    key: "distance_meters",
    label: "Distance",
    sortable: true,
    tooltip: "Total ride distance",
  },
  {
    key: "elevation_gain_meters",
    label: "Elevation",
    sortable: true,
    tooltip: "Total elevation gain for the ride",
  },
  {
    key: "moving_time_seconds",
    label: "Time",
    sortable: true,
    tooltip: "Total moving time (excludes stopped time)",
  },
  {
    key: "tailwind_component_ms",
    label: "Tailwind",
    sortable: true,
    tooltip:
      "Wind assistance along the ride direction (mph). Green (+) = tailwind pushing you forward. Red (−) = headwind slowing you down. Sourced from Open-Meteo historical weather data.",
  },
  {
    key: "average_watts",
    label: "Avg W",
    sortable: true,
    tooltip: "Average watts (power meter required)",
  },
  {
    key: "max_watts",
    label: "Max W",
    sortable: true,
    tooltip: "Maximum watts",
  },
  {
    key: "average_heartrate",
    label: "Avg HR",
    sortable: true,
    tooltip: "Average heart rate (HR monitor required)",
  },
  {
    key: "kilojoules",
    label: "Cal",
    sortable: true,
    tooltip: "Calories burned (estimated from Strava kilojoules)",
  },
  {
    key: "edit",
    label: "",
    sortable: false,
    className: "rides-table__edit-col",
    tooltip: "Edit ride",
  },
];

const SKELETON_ROWS = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function RidesLeaderboardTable({
  rides,
  totalCount,
  isLoading,
  sortBy,
  sortDir,
  onSortChange,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  activeUser,
  onClearUser,
}: RidesLeaderboardTableProps) {
  const tableRef = useColumnResize<HTMLTableElement>();
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const [editingRide, setEditingRide] = useState<EditRideData | null>(null);
  const loadMoreRef = useRef<HTMLTableRowElement>(null);

  // IntersectionObserver for infinite scroll
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

  const handleSort = (col: ColumnDef) => {
    if (!col.sortable) return;
    if (sortBy === col.key) {
      // Same column: toggle direction
      onSortChange(col.key, sortDir === "desc" ? "asc" : "desc");
    } else {
      // New column: default to descending
      onSortChange(col.key, "desc");
    }
  };

  const ariaSortValue = (
    col: ColumnDef,
  ): "ascending" | "descending" | "none" => {
    if (sortBy !== col.key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  // Active user display name (find from first ride that matches)
  const activeUserName =
    activeUser && rides.length > 0
      ? (rides.find((r) => r.user_id === activeUser)?.display_name ?? "Rider")
      : null;

  return (
    <div className="rides-table">
      {/* User filter banner */}
      {activeUser && activeUserName && (
        <div className="rides-table__user-banner">
          <span>
            Showing rides for <strong>{activeUserName}</strong>
          </span>
          {onClearUser && (
            <button
              className="rides-table__clear-btn"
              onClick={onClearUser}
              aria-label="Clear rider filter"
            >
              ✕ Clear filter
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rides-table__wrapper">
        <table ref={tableRef} role="grid" aria-label="Rides leaderboard">
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
                      className={`sort-indicator${sortBy === col.key ? "" : " sort-indicator--placeholder"}`}
                    >
                      {sortBy === col.key
                        ? sortDir === "asc"
                          ? "▲"
                          : "▼"
                        : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : rides.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="rides-table__empty">
                  No rides match the current filters
                </td>
              </tr>
            ) : (
              rides.map((ride, idx) => (
                <RideRow
                  key={ride.id}
                  ride={ride}
                  rank={idx + 1}
                  currentUserId={currentUser?.id}
                  onEdit={setEditingRide}
                />
              ))
            )}
            {hasNextPage && (
              <tr ref={loadMoreRef}>
                <td
                  colSpan={COLUMNS.length}
                  style={{ textAlign: "center", padding: "1rem" }}
                >
                  {isFetchingNextPage ? (
                    <div
                      className="rides-table__skeleton"
                      style={{ width: "60%", margin: "0 auto" }}
                    />
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

      {/* Edit Ride Dialog */}
      {editingRide && (
        <EditRideDialog
          ride={editingRide}
          isOpen={!!editingRide}
          onClose={() => setEditingRide(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------
function RideRow({
  ride,
  rank,
  currentUserId,
  onEdit,
}: {
  ride: RideLeaderboardEntry;
  rank: number;
  currentUserId?: string;
  onEdit: (ride: EditRideData) => void;
}) {
  const unit = useUnit();
  return (
    <tr>
      {/* Rank */}
      <td className="rides-table__rank">{rank}</td>

      {/* Rider */}
      <td>
        <div className="rides-table__rider">
          {ride.avatar_url ? (
            <img
              className="rides-table__avatar"
              src={ride.avatar_url}
              alt=""
              loading="lazy"
              width={32}
              height={32}
            />
          ) : (
            <span className="rides-table__avatar-fallback" aria-hidden="true">
              👤
            </span>
          )}
          <Link
            to="/profile/$userId"
            params={{ userId: ride.user_id }}
            className="rides-table__rider-name"
          >
            {ride.display_name ?? "Unknown Rider"}
          </Link>
        </div>
      </td>

      {/* Ride Name */}
      <td className="rides-table__ride-name" title={ride.name ?? undefined}>
        {ride.strava_activity_id ? (
          <a
            href={`https://www.strava.com/activities/${String(ride.strava_activity_id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-rides__strava-link"
          >
            {ride.name ?? "—"}
          </a>
        ) : (
          (ride.name ?? "—")
        )}
      </td>

      {/* Date */}
      <td>{formatRideDate(ride.ride_date) ?? "—"}</td>

      {/* Route */}
      <td>
        {ride.route_category ? (
          <RouteTag category={ride.route_category} />
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Avg Speed */}
      <td>{formatSpeed(ride.average_speed_mps, unit)}</td>

      {/* Distance */}
      <td>{formatDistance(ride.distance_meters, unit)}</td>

      {/* Elevation */}
      <td>{formatElevation(ride.elevation_gain_meters, unit)}</td>

      {/* Moving Time */}
      <td>{formatMovingTime(ride.moving_time_seconds)}</td>

      {/* Tailwind */}
      <td>
        {ride.tailwind_component_ms != null ? (
          <span
            style={{
              color:
                ride.tailwind_component_ms > 0.5
                  ? "var(--color-success)"
                  : ride.tailwind_component_ms < -0.5
                    ? "var(--color-error)"
                    : "var(--color-text-muted)",
              fontWeight: 500,
            }}
          >
            {(() => {
              const mph = msToMph(ride.tailwind_component_ms);
              const sign = mph > 0 ? "+" : "";
              return Math.abs(mph) < 0.5 ? "—" : `${sign}${mph.toFixed(1)}`;
            })()}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Avg Watts */}
      <td>
        {ride.average_watts != null
          ? `${Math.round(ride.average_watts)}W`
          : "—"}
      </td>

      {/* Max Watts */}
      <td>{ride.max_watts != null ? `${Math.round(ride.max_watts)}W` : "—"}</td>

      {/* Avg HR */}
      <td>
        {ride.average_heartrate != null
          ? `${Math.round(ride.average_heartrate)}bpm`
          : "—"}
      </td>

      {/* Cal */}
      <td>{ride.kilojoules != null ? Math.round(ride.kilojoules) : "—"}</td>

      {/* Edit */}
      <td className="rides-table__edit-col">
        {currentUserId && currentUserId === ride.user_id && (
          <Tooltip content="Edit this ride">
            <button
              className="edit-ride-btn"
              onClick={() =>
                onEdit({
                  id: ride.id,
                  name: ride.name,
                  rideDate: ride.ride_date,
                  routeCategory: ride.route_category,
                  stravaActivityId: ride.strava_activity_id,
                })
              }
              aria-label="Edit ride"
            >
              ✏️
            </button>
          </Tooltip>
        )}
      </td>
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
        <tr key={`skel-${i}`} className="rides-table__skeleton-row">
          {COLUMNS.map((col) => (
            <td key={col.key}>
              <div className="rides-table__skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
