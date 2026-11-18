/**
 * The Segments view (phase 09d): one row per selectable segment of the
 * route, Strava style. The checkbox adds or removes it from the cumulative
 * selection; expanding a row lists every SF2G rider's PR on it, with links to
 * the activities on Strava (required by the Strava API agreement).
 */
import { useEffect, useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  segmentBoard,
  segmentStats,
  stravaKomSeconds,
  type Matrix,
  type MatrixSegment,
  type SegmentStats,
} from "../lib/segment-cumulative";
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
import { HonourBadges } from "./SegmentHonours";

interface Row {
  segment: MatrixSegment;
  stats: SegmentStats;
  leader: ReturnType<typeof segmentBoard>[number] | undefined;
}

function columns(
  unit: UnitSystem,
  included: ReadonlySet<number>,
  onToggle: (id: number) => void,
): ColumnDef<Row, any>[] {
  return [
    {
      id: "in",
      header: "Use",
      size: 48,
      enableSorting: false,
      meta: { title: "Count this segment in the cumulative leaderboard" },
      cell: ({ row: { original: r } }) => (
        <input
          type="checkbox"
          checked={included.has(r.segment.id)}
          aria-label={`Count ${r.segment.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggle(r.segment.id)}
        />
      ),
    },
    {
      id: "name",
      header: "Segment",
      size: 240,
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original.segment;
        return (
          <div className="segments__segment" data-segment-row={s.id}>
            <span className="segments__expand" aria-hidden="true">
              {row.getIsExpanded() ? "▾" : "▸"}
            </span>
            <div>
              <div className="segments__segment-name">{s.name}</div>
              <div className="segments__segment-meta">
                {formatSegmentDistance(s.distance_meters, unit)} ·{" "}
                {s.average_grade.toFixed(1)}% · {s.terrain}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: "kom",
      header: "Strava KOM",
      enableSorting: false,
      cell: ({ row: { original: r } }) =>
        formatSegmentTime(stravaKomSeconds(r.segment)),
    },
    {
      id: "leader",
      header: "SF2G record",
      size: 230,
      enableSorting: false,
      cell: ({ row: { original: r } }) =>
        r.leader ? (
          <div className="segments__leader">
            <SegmentRider
              userId={r.leader.rider.user_id}
              displayName={r.leader.rider.display_name}
              avatarUrl={r.leader.rider.avatar_url}
            />
            <span className="segments__time">
              {formatSegmentTime(r.leader.cell.seconds)}
            </span>
            <HonourBadges
              honours={r.leader.honours}
              komSeconds={stravaKomSeconds(r.segment)}
              checkedAt={r.segment.xoms_fetched_at}
            />
          </div>
        ) : (
          "—"
        ),
    },
    {
      id: "pct",
      header: "% of KOM",
      enableSorting: false,
      cell: ({ row: { original: r } }) => formatPctOfKom(r.leader?.pct_of_kom),
    },
    {
      id: "riders",
      header: "Riders",
      enableSorting: false,
      cell: ({ row: { original: r } }) => r.stats.riders,
    },
    {
      id: "median",
      header: "Median PR",
      enableSorting: false,
      cell: ({ row: { original: r } }) =>
        formatSegmentTime(r.stats.median_seconds),
    },
    {
      id: "attempts",
      header: "Efforts",
      enableSorting: false,
      meta: { title: "SF2G efforts on this segment" },
      cell: ({ row: { original: r } }) => r.stats.attempts,
    },
  ];
}

function Board({ matrix, row }: { matrix: Matrix; row: Row }) {
  const board = segmentBoard(matrix, row.segment.id);
  const s = row.stats;
  const kom = stravaKomSeconds(row.segment);
  return (
    <div className="segments__riders">
      <p className="segments__versus">
        {s.most_efforts && (
          <>
            Most efforts: <strong>{s.most_efforts.rider.display_name}</strong> (
            {s.most_efforts.efforts}).{" "}
          </>
        )}
        {s.newest_pr && (
          <>
            Newest PR: <strong>{s.newest_pr.rider.display_name}</strong>,{" "}
            {formatRideDate(s.newest_pr.date)}.{" "}
          </>
        )}
        {s.first_gap_seconds !== null && (
          <>
            Record margin{" "}
            {formatSegmentTime(s.first_gap_seconds) === "—"
              ? "0:00"
              : formatSegmentTime(s.first_gap_seconds)}
            .{" "}
          </>
        )}
        {Math.round(row.segment.ride_share * 100)}% of fetched rides cover it.
      </p>
      <ol
        className="segments__riders-list"
        aria-label={`${row.segment.name} — SF2G riders`}
      >
        {board.map((r) => (
          <li key={r.rider.user_id} className="segments__riders-item">
            <span className="segments__riders-rank">{r.rank}</span>
            <SegmentRider
              userId={r.rider.user_id}
              displayName={r.rider.display_name}
              avatarUrl={r.rider.avatar_url}
            />
            <span className="segments__time">
              {formatSegmentTime(r.cell.seconds)}
            </span>
            <HonourBadges
              honours={r.honours}
              komSeconds={kom}
              checkedAt={row.segment.xoms_fetched_at}
            />
            <span className="segments__riders-date">
              {r.gap_seconds > 0
                ? `+${formatSegmentTime(r.gap_seconds)} · `
                : ""}
              {formatRideDate(r.cell.date)} · {r.cell.efforts}×
            </span>
            <a
              className="segments__strava-link"
              href={`https://www.strava.com/activities/${r.cell.strava_activity_id}`}
              target="_blank"
              rel="noopener"
              onClick={(e) => e.stopPropagation()}
            >
              View on Strava
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SegmentBoards({
  matrix,
  included,
  onToggle,
  hoveredId = null,
  onHover,
  focusRequest = null,
}: {
  matrix: Matrix;
  included: ReadonlySet<number>;
  onToggle: (id: number) => void;
  hoveredId?: number | null;
  onHover?: (id: number | null) => void;
  /** Expand this segment's row and scroll to it; `n` re-triggers the same id. */
  focusRequest?: { id: number; n: number } | null;
}) {
  const unit = useUnit();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rows = useMemo<Row[]>(
    () =>
      matrix.segments.map((segment) => ({
        segment,
        stats: segmentStats(matrix, segment.id),
        leader: segmentBoard(matrix, segment.id)[0],
      })),
    [matrix],
  );
  const cols = useMemo(
    () => columns(unit, included, onToggle),
    [unit, included, onToggle],
  );
  const table = useDataTable({
    data: rows,
    columns: cols,
    sort: "",
    dir: "asc",
    onSortChange: () => {},
    getRowId: (r) => String(r.segment.id),
    getRowCanExpand: () => true,
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  return (
    <div ref={wrapperRef}>
      <DataTable
        table={table}
        ariaLabel="Segment boards"
        className="segments__table-wrapper"
        scrollClassName="table-scroll"
        tableClassName="leaderboard__table segments__table"
        onRowClick={(row) => row.toggleExpanded()}
        getRowProps={(row) => ({
          className:
            [
              row.getIsExpanded() ? "segments__row--expanded" : "",
              row.original.segment.id === hoveredId
                ? "segments__row--hovered"
                : "",
              included.has(row.original.segment.id) ? "" : "segments__row--off",
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          onMouseEnter: onHover
            ? () => onHover(row.original.segment.id)
            : undefined,
          onMouseLeave: onHover ? () => onHover(null) : undefined,
        })}
        renderSubRow={(row) => <Board matrix={matrix} row={row.original} />}
        empty={
          <TableEmpty icon="⛰️" title="No segments yet">
            Segments appear once rides on this route have been fetched and
            curated.
          </TableEmpty>
        }
      />
    </div>
  );
}
