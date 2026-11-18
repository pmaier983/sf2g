/**
 * The Crown view (phase 09d): who holds the most over the selected
 * segments. Strava KOMs first (the rarest honour), then SF2G records, then
 * podium points.
 */
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { CrownRow } from "../lib/segment-cumulative";
import { DataTable } from "./table/DataTable";
import { TableEmpty } from "./table/TableStates";
import { useDataTable, type SortDir } from "./table/useDataTable";
import { SegmentRider } from "./SegmentRider";

const COLUMNS: ColumnDef<CrownRow, any>[] = [
  { accessorKey: "rank", header: "#", size: 44, meta: { defaultDir: "asc" } },
  {
    id: "rider",
    header: "Rider",
    size: 220,
    enableSorting: false,
    cell: ({ row: { original: r } }) => (
      <SegmentRider
        userId={r.rider.user_id}
        displayName={r.rider.display_name}
        avatarUrl={r.rider.avatar_url}
      />
    ),
  },
  {
    accessorKey: "strava_koms",
    header: "♛ Strava KOMs",
    meta: { title: "Current Strava KOMs (all athletes) held" },
  },
  {
    accessorKey: "sf2g_records",
    header: "★ SF2G records",
    meta: { title: "Segments where they are the fastest SF2G rider" },
  },
  { accessorKey: "podiums", header: "Podiums" },
  {
    accessorKey: "points",
    header: "Points",
    meta: { title: "10 for 1st, 9 for 2nd … 1 for 10th, over the selection" },
  },
  {
    id: "coverage",
    header: "Coverage",
    accessorFn: (r) => r.segments_ridden,
    cell: ({ row: { original: r } }) => `${r.segments_ridden}/${r.of}`,
  },
];

export function SegmentCrownView({ rows }: { rows: CrownRow[] }) {
  const [sort, setSort] = useState<{ sort: string; dir: SortDir }>({
    sort: "rank",
    dir: "asc",
  });
  const data = useMemo(() => rows, [rows]);
  const table = useDataTable({
    data,
    columns: COLUMNS,
    sort: sort.sort,
    dir: sort.dir,
    onSortChange: (s, d) => setSort({ sort: s, dir: d }),
    sortClientSide: true,
    getRowId: (r) => r.rider.user_id,
  });
  return (
    <DataTable
      table={table}
      ariaLabel="Segment crown"
      className="segments__table-wrapper"
      scrollClassName="table-scroll"
      tableClassName="leaderboard__table segments__table"
      empty={
        <TableEmpty icon="♛" title="No times yet">
          Nobody has a time on the selected segments.
        </TableEmpty>
      }
    />
  );
}
