/**
 * Segment board — one row per Skyline segment shown (climbs and flats), in
 * the order get_segment_leaderboard returns (curated first, then most
 * riders). Clicking a row lists its SF2G top riders with links to the
 * efforts' activities on Strava (required by the Strava API agreement).
 *
 * Linked to the route view (07c): hovering a row highlights its segment on
 * the map and profile; picking a segment there expands its row and scrolls
 * to it (`focusRequest`).
 */
import { useEffect, useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  SegmentBoardRow,
  SegmentRider as Rider,
} from "../server/segments";
import { formatRideDate } from "../lib/leaderboard-utils";
import {
  formatPctOfKom,
  formatSegmentDistance,
  formatSegmentTime,
} from "../lib/segment-format";
import { useUnit } from "../lib/useUnit";
import type { UnitSystem } from "./UnitToggle";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable } from "./table/useDataTable";
import { SegmentRider } from "./SegmentRider";

export interface SegmentBoardProps {
  segments: SegmentBoardRow[] | undefined;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  hoveredId?: number | null;
  onHover?: (id: number | null) => void;
  /** A row was expanded (its segment becomes the selected one). */
  onSelect?: (id: number | null) => void;
  /** Expand this segment's row and scroll to it; `n` re-triggers the same id. */
  focusRequest?: { id: number; n: number } | null;
}

const TERRAIN_LABEL = { climb: "Climb", flat: "Flat" } as const;

function boardColumns(unit: UnitSystem): ColumnDef<SegmentBoardRow, any>[] {
  return [
    {
      accessorKey: "name",
      header: "Segment",
      size: 240,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="segments__segment" data-segment-row={s.id}>
            <span className="segments__expand" aria-hidden="true">
              {row.getIsExpanded() ? "▾" : "▸"}
            </span>
            <div>
              <div className="segments__segment-name">{s.name}</div>
              <div className="segments__segment-meta">
                {formatSegmentDistance(s.distance_meters, unit)} ·{" "}
                {s.average_grade.toFixed(1)}%
                {s.direction === "north" ? " · northbound" : ""}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "terrain",
      header: "Terrain",
      enableSorting: false,
      cell: (info) =>
        TERRAIN_LABEL[info.getValue() as keyof typeof TERRAIN_LABEL] ??
        info.getValue(),
    },
    {
      accessorKey: "kom_seconds",
      header: "KOM",
      enableSorting: false,
      meta: { title: "Strava's KOM time on this segment (all athletes)" },
      cell: (info) => formatSegmentTime(info.getValue()),
    },
    {
      id: "leader",
      header: "SF2G leader",
      size: 220,
      enableSorting: false,
      cell: ({ row: { original: s } }) => {
        const r = s.riders[0];
        if (!r) return "—";
        return (
          <div className="segments__leader">
            <SegmentRider
              userId={r.user_id}
              displayName={r.display_name}
              avatarUrl={r.avatar_url}
            />
            <span className="segments__time">
              {formatSegmentTime(r.best_seconds)}
            </span>
          </div>
        );
      },
    },
    {
      id: "pct_of_kom",
      header: "% of KOM",
      enableSorting: false,
      meta: { title: "KOM time ÷ SF2G leader's time" },
      cell: ({ row: { original: s } }) =>
        formatPctOfKom(s.riders[0]?.pct_of_kom),
    },
    {
      accessorKey: "rider_count",
      header: "Riders",
      enableSorting: false,
      meta: { title: "Opted-in SF2G riders with an effort on this segment" },
    },
  ];
}

function RiderList({ segment }: { segment: SegmentBoardRow }) {
  return (
    <div className="segments__riders">
      <ol
        className="segments__riders-list"
        aria-label={`${segment.name} — SF2G top riders`}
      >
        {segment.riders.map((r: Rider) => (
          <li key={r.user_id} className="segments__riders-item">
            <span className="segments__riders-rank">{r.rank}</span>
            <SegmentRider
              userId={r.user_id}
              displayName={r.display_name}
              avatarUrl={r.avatar_url}
            />
            <span className="segments__time">
              {formatSegmentTime(r.best_seconds)}
            </span>
            <span className="segments__riders-date">
              {formatRideDate(r.best_date)}
            </span>
            <a
              className="segments__strava-link"
              href={`https://www.strava.com/activities/${r.strava_activity_id}`}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              View on Strava
            </a>
          </li>
        ))}
      </ol>
      {segment.rider_count > segment.riders.length && (
        <p className="segments__riders-more">
          Top {segment.riders.length} of {segment.rider_count} SF2G riders.
        </p>
      )}
    </div>
  );
}

export function SegmentBoard({
  segments,
  isLoading,
  error,
  onRetry,
  hoveredId = null,
  onHover,
  onSelect,
  focusRequest = null,
}: SegmentBoardProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const unit = useUnit();
  const columns = useMemo(() => boardColumns(unit), [unit]);
  const data = useMemo(() => segments ?? [], [segments]);
  const table = useDataTable({
    data,
    columns,
    // Server order (curated, then most riders); no column sorts.
    sort: "",
    dir: "asc",
    onSortChange: () => {},
    getRowId: (s) => String(s.id),
    getRowCanExpand: () => true,
  });

  // A segment picked on the map/profile: expand its row, scroll it into view.
  useEffect(() => {
    if (!focusRequest) return;
    const row = table.getRowModel().rowsById[String(focusRequest.id)];
    if (!row) return;
    row.toggleExpanded(true);
    requestAnimationFrame(() => {
      wrapperRef.current
        ?.querySelector(`[data-segment-row="${focusRequest.id}"]`)
        ?.closest("tr")
        ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
    // `table` is stable; re-run only for a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return (
    <div ref={wrapperRef}>
      <DataTable
        table={table}
        ariaLabel="Skyline segment board"
        className="segments__table-wrapper"
        scrollClassName="table-scroll"
        tableClassName="leaderboard__table segments__table"
        onRowClick={(row) => {
          const expand = !row.getIsExpanded();
          row.toggleExpanded(expand);
          onSelect?.(expand ? row.original.id : null);
        }}
        getRowProps={(row) => ({
          className:
            [
              row.getIsExpanded() ? "segments__row--expanded" : "",
              row.original.id === hoveredId ? "segments__row--hovered" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          onMouseEnter: onHover ? () => onHover(row.original.id) : undefined,
          onMouseLeave: onHover ? () => onHover(null) : undefined,
        })}
        renderSubRow={(row) => <RiderList segment={row.original} />}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        skeletonRows={6}
        empty={
          <TableEmpty icon="⛰️" title="No segments to show">
            No segment has at least 3 opted-in riders for these filters.
          </TableEmpty>
        }
      />
    </div>
  );
}
