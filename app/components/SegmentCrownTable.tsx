/**
 * Skyline crown — one row per opted-in rider: SF2G KOMs, podiums, points and
 * closeness to the Strava KOM across the segments shown. Ranked in SQL
 * (get_segment_leaderboard); header clicks re-sort in the browser.
 */
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { SegmentCrownEntry } from "../server/segments";
import { formatPctOfKom } from "../lib/segment-format";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";
import { SegmentRider } from "./SegmentRider";

export interface SegmentCrownTableProps {
  crown: SegmentCrownEntry[] | undefined;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

const columns: ColumnDef<SegmentCrownEntry, any>[] = [
  {
    accessorKey: "rank",
    header: "#",
    size: 50,
    meta: {
      defaultDir: "asc",
      className: "segments__rank",
      title: "Crown rank: SF2G KOMs, then points",
    },
  },
  {
    accessorKey: "display_name",
    header: "Rider",
    size: 200,
    meta: { defaultDir: "asc" },
    cell: ({ row: { original: r } }) => (
      <SegmentRider
        userId={r.user_id}
        displayName={r.display_name}
        avatarUrl={r.avatar_url}
      />
    ),
  },
  {
    accessorKey: "sf2g_koms",
    header: "SF2G KOMs",
    meta: { title: "Segments where this rider has the fastest SF2G time" },
  },
  {
    accessorKey: "podiums",
    header: "Podiums",
    meta: { title: "Segments where this rider is in the SF2G top 3" },
  },
  {
    accessorKey: "points",
    header: "Points",
    meta: { title: "10 points for 1st, 9 for 2nd … 1 for 10th, per segment" },
  },
  {
    accessorKey: "mean_pct_of_kom",
    header: "Avg % of KOM",
    meta: {
      title:
        "Average of Strava KOM time ÷ rider's best time, over segments with a known KOM",
    },
    cell: (info) => formatPctOfKom(info.getValue()),
  },
  {
    id: "coverage",
    accessorFn: (r) => r.segments_ridden / Math.max(r.segments_total, 1),
    header: "Coverage",
    meta: { title: "Segments ridden out of the segments shown" },
    cell: ({ row: { original: r } }) =>
      `${r.segments_ridden}/${r.segments_total}`,
  },
  {
    accessorKey: "strava_top10s",
    header: "Strava top-10s",
    meta: {
      title:
        "Segments where one of the rider's efforts reached Strava's own top 10",
    },
  },
];

export function SegmentCrownTable({
  crown,
  isLoading,
  error,
  onRetry,
}: SegmentCrownTableProps) {
  const [sort, setSort] = useState<{ sort: string; dir: SortDir }>({
    sort: "rank",
    dir: "asc",
  });
  const data = useMemo(() => crown ?? [], [crown]);
  const table = useDataTable({
    data,
    columns,
    sort: sort.sort,
    dir: sort.dir,
    onSortChange: (s, d) => setSort({ sort: s, dir: d }),
    sortClientSide: true,
    getRowId: (r) => r.user_id,
  });

  return (
    <DataTable
      table={table}
      ariaLabel="Skyline crown"
      className="segments__table-wrapper"
      scrollClassName="table-scroll"
      tableClassName="leaderboard__table segments__table"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      skeletonRows={6}
      empty={
        <TableEmpty icon="👑" title="No riders yet">
          No opted-in rider has efforts on these segments.
        </TableEmpty>
      }
    />
  );
}
