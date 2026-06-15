/**
 * ProfileRidesTable — sortable, paginated table of ALL user rides.
 *
 * Features:
 * - Shows ALL rides (SF2G and non-SF2G), not just classified ones
 * - Server-side pagination (25 per page)
 * - Sortable columns (date, route, speed, distance, elevation, time)
 * - Route category tag (or "—" for non-SF2G rides)
 * - Unit-aware formatting (mi/km)
 * - Edit button for own profile
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RouteTag } from "./RouteTag";
import { useUnit } from "../lib/useUnit";
import { currentUserQueryOptions } from "../queries/user";
import { allUserRidesQueryOptions } from "../queries/rides";
import { EditRideDialog } from "./EditRideDialog";
import type { EditRideData } from "./EditRideDialog";
import type { RouteCategory } from "../lib/database.types";
import { Tooltip } from "./Tooltip";
import {
  formatDistance,
  formatElevation,
  formatSpeed,
  formatMovingTime,
  formatRideDate,
} from "../lib/leaderboard-utils";

interface ProfileRidesTableProps {
  profileUserId: string;
}

type SortKey =
  | "ride_date"
  | "name"
  | "route_category"
  | "average_speed_mps"
  | "distance_meters"
  | "elevation_gain_meters"
  | "moving_time_seconds";

const BASE_COLUMNS: {
  key: SortKey;
  label: string;
  className?: string;
}[] = [
  { key: "ride_date", label: "Date" },
  { key: "name", label: "Ride Name", className: "profile-rides__name-col" },
  { key: "route_category", label: "Route" },
  { key: "average_speed_mps", label: "Avg Speed" },
  { key: "distance_meters", label: "Distance" },
  { key: "elevation_gain_meters", label: "Elevation" },
  { key: "moving_time_seconds", label: "Time" },
];

const PAGE_SIZE = 25;

export function ProfileRidesTable({ profileUserId }: ProfileRidesTableProps) {
  const unit = useUnit();
  const { data: currentUser } = useQuery(currentUserQueryOptions());
  const [editingRide, setEditingRide] = useState<EditRideData | null>(null);
  const isOwnProfile = currentUser?.id === profileUserId;
  const [sortKey, setSortKey] = useState<SortKey>("ride_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data: rides, isLoading } = useQuery(
    allUserRidesQueryOptions(profileUserId, page, PAGE_SIZE),
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => {
    if (!rides) return [];
    let filtered = rides;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = rides.filter((r) => r.name?.toLowerCase().includes(term));
    }
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // Handle nulls
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // String comparison for name/date/route
      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = aVal.localeCompare(bVal);
        return sortDir === "asc" ? cmp : -cmp;
      }

      // Numeric comparison
      const numA = Number(aVal);
      const numB = Number(bVal);
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
  }, [rides, sortKey, sortDir, search]);

  const hasMore = rides?.length === PAGE_SIZE;
  const totalShown = (page - 1) * PAGE_SIZE + (rides?.length ?? 0);

  return (
    <div className="profile-rides">
      {/* Ride count + pagination info */}
      <div className="profile-rides__filter-row">
        <span className="profile-rides__count">
          All rides · Page {page}
          {isLoading ? "" : ` (${totalShown} shown)`}
        </span>
        <input
          id="profile-rides-search"
          type="text"
          className="profile-rides__search"
          placeholder="Search rides…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="profile-rides__table-wrapper">
        <table className="profile-rides__table">
          <thead>
            <tr>
              {BASE_COLUMNS.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={col.className}
                    onClick={() => handleSort(col.key)}
                    style={{ cursor: "pointer" }}
                    aria-sort={
                      isSorted
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    {col.label}
                    {isSorted && (
                      <span className="sort-indicator">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </th>
                );
              })}
              {isOwnProfile && <th className="profile-rides__edit-col" />}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // Skeleton rows
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${String(i)}`}>
                  {BASE_COLUMNS.map((col) => (
                    <td key={col.key}>
                      <div className="profile-rides__skeleton" />
                    </td>
                  ))}
                  {isOwnProfile && <td />}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={BASE_COLUMNS.length + (isOwnProfile ? 1 : 0)}
                  style={{
                    textAlign: "center",
                    padding: "var(--space-6)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  No rides found
                </td>
              </tr>
            ) : (
              sorted.map((ride) => (
                <tr
                  key={ride.id}
                  className={
                    ride.is_hidden ? "profile-rides__row--excluded" : ""
                  }
                >
                  <td>{formatRideDate(ride.ride_date) ?? "—"}</td>
                  <td
                    className="profile-rides__name-col"
                    title={ride.name ?? undefined}
                  >
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
                  <td>
                    <div className="profile-rides__route-cell">
                      {ride.route_category ? (
                        <RouteTag
                          category={ride.route_category as RouteCategory}
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {ride.is_hidden && (
                        <span className="profile-rides__excluded-badge">
                          Excluded
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{formatSpeed(ride.average_speed_mps, unit)}</td>
                  <td>{formatDistance(ride.distance_meters, unit)}</td>
                  <td>{formatElevation(ride.elevation_gain_meters, unit)}</td>
                  <td>{formatMovingTime(ride.moving_time_seconds)}</td>
                  {isOwnProfile && (
                    <td className="profile-rides__edit-col">
                      <Tooltip
                        content={
                          ride.is_hidden
                            ? "Restore / edit this ride"
                            : "Edit this ride"
                        }
                      >
                        <button
                          className={`edit-ride-btn${ride.is_hidden ? " edit-ride-btn--restore" : ""}`}
                          onClick={() =>
                            setEditingRide({
                              id: ride.id,
                              name: ride.name,
                              rideDate: ride.ride_date,
                              routeCategory:
                                ride.route_category as RouteCategory | null,
                              stravaActivityId: ride.strava_activity_id,
                              isHidden: ride.is_hidden ?? undefined,
                            })
                          }
                          aria-label={
                            ride.is_hidden ? "Restore ride" : "Edit ride"
                          }
                        >
                          {ride.is_hidden ? "↩️" : "✏️"}
                        </button>
                      </Tooltip>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div className="profile-rides__pagination">
        <button
          className="btn btn--ghost btn--sm"
          disabled={page === 1 || isLoading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Previous
        </button>
        <span className="profile-rides__page-info">Page {page}</span>
        <button
          className="btn btn--ghost btn--sm"
          disabled={!hasMore || isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next →
        </button>
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
