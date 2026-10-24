/**
 * useDataTable — a TanStack Table instance with SF2G's sorting rules:
 *
 * - Sorting is controlled: `sort`/`dir` come from the URL (TableQuery) or the
 *   caller's state; header clicks call `onSortChange` (see `nextSort`).
 * - Clicking the sorted column flips its direction; clicking another column
 *   starts at that column's `meta.defaultDir` (default "desc"). Never unsorted.
 * - Server-sorted data is shown in the order received. `sortClientSide`
 *   sorts in the browser instead (small tables), empty values last.
 * - Column widths are resizable and default to at least the header's text
 *   width, so headers are never clipped.
 */
import { useMemo } from "react";
import {
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type Table,
  type TableOptions,
} from "@tanstack/react-table";
import { columnId, fitHeaderSize, sortRows, type SortDir } from "./columns";

export type { SortDir };

export interface UseDataTableOptions<T> {
  data: readonly T[];
  columns: ColumnDef<T, any>[];
  sort: string;
  dir: SortDir;
  onSortChange: (sort: string, dir: SortDir) => void;
  /** Sort in the browser instead of trusting the server's order. */
  sortClientSide?: boolean;
  getRowId?: (row: T, index: number) => string;
  /** Rows that can expand to show DataTable's `renderSubRow`. */
  getRowCanExpand?: TableOptions<T>["getRowCanExpand"];
  meta?: TableOptions<T>["meta"];
}

/** Next sort when a header is clicked. */
export function nextSort(
  current: { sort: string; dir: SortDir },
  clicked: string,
  defaultDir: SortDir = "desc",
): { sort: string; dir: SortDir } {
  if (current.sort === clicked) {
    return { sort: clicked, dir: current.dir === "desc" ? "asc" : "desc" };
  }
  return { sort: clicked, dir: defaultDir };
}

export function useDataTable<T>(opts: UseDataTableOptions<T>): Table<T> {
  const {
    data,
    columns,
    sort,
    dir,
    onSortChange,
    sortClientSide = false,
    getRowId,
    getRowCanExpand,
    meta,
  } = opts;

  const sizedColumns = useMemo(
    () => columns.map((c) => ({ ...c, size: fitHeaderSize(c) })),
    [columns],
  );

  const rows = useMemo(
    () =>
      sortClientSide
        ? sortRows(
            data,
            columns.find((c) => columnId(c) === sort),
            dir,
          )
        : (data as T[]),
    [data, columns, sort, dir, sortClientSide],
  );

  return useReactTable<T>({
    data: rows,
    columns: sizedColumns,
    state: { sorting: [{ id: sort, desc: dir === "desc" }] },
    // Rows are already in display order (server or sortRows above).
    manualSorting: true,
    enableSortingRemoval: false,
    onSortingChange: () => {
      /* DataTable header buttons call onSortChange via nextSort */
    },
    getCoreRowModel: getCoreRowModel(),
    ...(getRowCanExpand
      ? { getRowCanExpand, getExpandedRowModel: getExpandedRowModel() }
      : {}),
    columnResizeMode: "onChange",
    getRowId,
    meta: { ...meta, onSortChange },
  });
}
