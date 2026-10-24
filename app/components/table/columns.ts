/**
 * Column helpers shared by every table.
 *
 * Column defs carry presentation in `meta` so DataTable can render any table
 * without per-table header/cell code:
 *   meta.className   — class on <th> and <td> (keeps each table's CSS)
 *   meta.title       — header tooltip
 *   meta.defaultDir  — first sort direction when the column is clicked
 */
import type { ColumnDef, RowData } from "@tanstack/react-table";

export type SortDir = "asc" | "desc";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    className?: string;
    title?: string;
    defaultDir?: SortDir;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    /** Set by useDataTable; DataTable's header buttons call it. */
    onSortChange?: (sort: string, dir: SortDir) => void;
  }
}

/** Approximate px per header character (bold UI font) + sort/resize room. */
const CHAR_PX = 8;
const HEADER_CHROME_PX = 36;
const DEFAULT_SIZE = 150;

/**
 * Default width: the column's own size, but never narrower than its header
 * text (T4 — headers used to be clipped at default widths).
 */
export function fitHeaderSize<T>(col: ColumnDef<T, any>): number {
  const base = col.size ?? DEFAULT_SIZE;
  const header = typeof col.header === "string" ? col.header : "";
  return Math.max(base, header.length * CHAR_PX + HEADER_CHROME_PX);
}

/** The id TanStack gives a column def. */
export function columnId<T>(col: ColumnDef<T, any>): string | undefined {
  return col.id ?? (col as { accessorKey?: string }).accessorKey;
}

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (typeof v === "number" && isNaN(v))
  );
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string")
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return (a as number) < (b as number)
    ? -1
    : (a as number) > (b as number)
      ? 1
      : 0;
}

/**
 * Sort rows by a column with empty values LAST in both directions (T6): a
 * rider without a power meter never tops the watts column. Stable, so ties
 * keep the incoming (server) order.
 */
export function sortRows<T>(
  rows: readonly T[],
  col: ColumnDef<T, any> | undefined,
  dir: SortDir,
): T[] {
  if (!col) return [...rows];
  const fn = (col as { accessorFn?: (r: T, i: number) => unknown }).accessorFn;
  const key = (col as { accessorKey?: string }).accessorKey;
  if (!fn && !key) return [...rows];
  const value = (r: T, i: number) =>
    fn ? fn(r, i) : (r as Record<string, unknown>)[key!];
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: value(r, i) }))
    .sort((a, b) => {
      const ae = isEmpty(a.v);
      const be = isEmpty(b.v);
      if (ae || be) return ae === be ? a.i - b.i : ae ? 1 : -1;
      return sign * compare(a.v, b.v) || a.i - b.i;
    })
    .map((x) => x.r);
}
