/**
 * The cumulative leaderboard (phase 09d): each rider's total of their PRs
 * over the selected segments. Riders with ≥ 80 % of the segments are ranked
 * (missing ones filled with the slowest time + 10 %, shown greyed); the rest
 * are listed underneath. A row expands to the rider's splits.
 */
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  versusAbove,
  type CumulativeResult,
  type CumulativeRow,
  type Matrix,
  type RankedRow,
} from "../lib/segment-cumulative";
import { formatRideDate } from "../lib/leaderboard-utils";
import { formatSegmentTime } from "../lib/segment-format";
import { useUnit } from "../lib/useUnit";
import type { UnitSystem } from "./UnitToggle";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";
import { SegmentRider } from "./SegmentRider";
import { HonourBadges, HonourCounts } from "./SegmentHonours";

const gap = (s: number) => (s === 0 ? "—" : `+${formatSegmentTime(s)}`);

function speed(distanceM: number, seconds: number, unit: UnitSystem): string {
  if (seconds <= 0) return "—";
  const kmh = (distanceM / seconds) * 3.6;
  return unit === "km"
    ? `${kmh.toFixed(1)} km/h`
    : `${(kmh / 1.609344).toFixed(1)} mph`;
}

type Row = RankedRow | (CumulativeRow & { rank: null; gap_seconds: null });

function columns(
  result: CumulativeResult,
  unit: UnitSystem,
): ColumnDef<Row, any>[] {
  return [
    {
      id: "rank",
      header: "#",
      size: 44,
      accessorFn: (r) => r.rank ?? Number.MAX_SAFE_INTEGER,
      meta: { defaultDir: "asc" },
      cell: ({ row }) => (
        <span className="segments__rank">
          <span className="segments__expand" aria-hidden="true">
            {row.getIsExpanded() ? "▾" : "▸"}
          </span>
          {row.original.rank ?? "–"}
        </span>
      ),
    },
    {
      id: "rider",
      header: "Rider",
      size: 220,
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="segments__leader">
          <SegmentRider
            userId={r.rider.user_id}
            displayName={r.rider.display_name}
            avatarUrl={r.rider.avatar_url}
          />
          <HonourCounts stravaKoms={r.strava_koms} records={r.sf2g_records} />
        </div>
      ),
    },
    {
      id: "total",
      header: "Total",
      accessorFn: (r) => r.total_seconds,
      meta: {
        defaultDir: "asc",
        title: "Sum of PRs over the selected segments",
      },
      cell: ({ row: { original: r } }) => (
        <span className="segments__time">
          {formatSegmentTime(r.total_seconds)}
        </span>
      ),
    },
    {
      id: "gap",
      header: "Gap",
      accessorFn: (r) => r.gap_seconds ?? Number.MAX_SAFE_INTEGER,
      meta: { defaultDir: "asc" },
      cell: ({ row: { original: r } }) =>
        r.gap_seconds === null ? "—" : gap(r.gap_seconds),
    },
    {
      id: "speed",
      header: "Avg speed",
      accessorFn: (r) => -r.total_seconds,
      enableSorting: false,
      meta: { title: "Timed distance ÷ total" },
      cell: ({ row: { original: r } }) =>
        speed(result.distance_m, r.total_seconds, unit),
    },
    {
      id: "done",
      header: "Segments",
      accessorFn: (r) => r.done,
      meta: { title: "Segments with a time (missing ones are filled)" },
      cell: ({ row: { original: r } }) =>
        r.done === r.of ? (
          `${r.done}/${r.of}`
        ) : (
          <span className="segments__partial">
            {r.done}/{r.of}
          </span>
        ),
    },
    {
      id: "pct",
      header: "% of KOMs",
      enableSorting: false,
      meta: { title: "Sum of Strava KOM times ÷ total" },
      cell: ({ row: { original: r } }) =>
        result.kom_total_seconds
          ? `${Math.round((result.kom_total_seconds / r.total_seconds) * 100)}%`
          : "—",
    },
  ];
}

function Splits({
  row,
  matrix,
  result,
}: {
  row: Row;
  matrix: Matrix;
  result: CumulativeResult;
}) {
  const vs = row.rank !== null ? versusAbove(result, row.rider.user_id) : null;
  const name = (id: number) => matrix.segmentById.get(id)?.name ?? String(id);
  return (
    <div className="segments__riders">
      {vs && (vs.lose || vs.gain) && (
        <p className="segments__versus">
          Against the rider above:{" "}
          {vs.lose && (
            <>
              loses most on <strong>{name(vs.lose.segment_id)}</strong> (
              {formatSegmentTime(vs.lose.seconds)})
            </>
          )}
          {vs.lose && vs.gain && "; "}
          {vs.gain && (
            <>
              gains most on <strong>{name(vs.gain.segment_id)}</strong> (
              {formatSegmentTime(vs.gain.seconds)})
            </>
          )}
          .
        </p>
      )}
      <table className="segments__splits">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Time</th>
            <th>Rank</th>
            <th>Behind</th>
            <th>Date</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {row.splits.map((sp) => {
            const seg = matrix.segmentById.get(sp.segment_id);
            return (
              <tr
                key={sp.segment_id}
                className={sp.filled ? "segments__split--filled" : undefined}
              >
                <td>
                  {seg?.name}{" "}
                  <HonourBadges
                    honours={sp.honours}
                    komSeconds={
                      seg ? (seg.overall_seconds ?? seg.kom_seconds) : null
                    }
                    checkedAt={seg?.xoms_fetched_at}
                  />
                </td>
                <td
                  className="segments__time"
                  title={
                    sp.filled
                      ? "No time: counted as the slowest time + 10 %"
                      : undefined
                  }
                >
                  {formatSegmentTime(sp.seconds)}
                </td>
                <td>{sp.rank ?? "—"}</td>
                <td>{gap(sp.behind_leader_seconds)}</td>
                <td>{sp.date ? formatRideDate(sp.date) : "missing"}</td>
                <td>
                  {sp.strava_activity_id && (
                    <a
                      className="segments__strava-link"
                      href={`https://www.strava.com/activities/${sp.strava_activity_id}`}
                      target="_blank"
                      rel="noopener"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View on Strava
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiderTable({
  rows,
  matrix,
  result,
  label,
  highlight,
  empty,
}: {
  rows: Row[];
  matrix: Matrix;
  result: CumulativeResult;
  label: string;
  highlight?: string | null;
  empty: React.ReactNode;
}) {
  const unit = useUnit();
  const cols = useMemo(() => columns(result, unit), [result, unit]);
  const [sort, setSort] = useState<{ sort: string; dir: SortDir }>({
    sort: "rank",
    dir: "asc",
  });
  const table = useDataTable({
    data: rows,
    columns: cols,
    sort: sort.sort,
    dir: sort.dir,
    onSortChange: (s, d) => setSort({ sort: s, dir: d }),
    sortClientSide: true,
    getRowId: (r) => r.rider.user_id,
    getRowCanExpand: () => true,
  });
  return (
    <DataTable
      table={table}
      ariaLabel={label}
      className="segments__table-wrapper"
      scrollClassName="table-scroll"
      tableClassName="leaderboard__table segments__table"
      onRowClick={(row) => row.toggleExpanded()}
      getRowProps={(row) => ({
        className:
          [
            row.getIsExpanded() ? "segments__row--expanded" : "",
            row.original.rider.user_id === highlight ? "segments__row--me" : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      })}
      renderSubRow={(row) => (
        <Splits row={row.original} matrix={matrix} result={result} />
      )}
      empty={empty}
    />
  );
}

export function CumulativeBoard({
  matrix,
  result,
  meId,
}: {
  matrix: Matrix;
  result: CumulativeResult;
  meId?: string | null;
}) {
  const ranked: Row[] = result.ranked;
  const partial: Row[] = result.partial.map((r) => ({
    ...r,
    rank: null,
    gap_seconds: null,
  }));
  return (
    <>
      <RiderTable
        rows={ranked}
        matrix={matrix}
        result={result}
        label="Cumulative leaderboard"
        highlight={meId}
        empty={
          <TableEmpty icon="⛰️" title="Nobody has ridden enough of these">
            A rider needs a time on {result.required} of the{" "}
            {result.segments.length} selected segments to be ranked.
          </TableEmpty>
        }
      />
      {partial.length > 0 && (
        <section className="segments__section" aria-labelledby="partial-title">
          <h3 id="partial-title" className="segments__section-title">
            Missing segments
            <span className="segments__count">
              under {result.required} of {result.segments.length}, not ranked
            </span>
          </h3>
          <RiderTable
            rows={partial}
            matrix={matrix}
            result={result}
            label="Riders missing segments"
            highlight={meId}
            empty={null}
          />
        </section>
      )}
    </>
  );
}
