/**
 * DataTable — the one table shell every SF2G table renders through.
 *
 * Owns: header sort affordance (a real <button>, `aria-sort`), column
 * resizing, optional row virtualization, infinite-scroll loading,
 * expandable sub-rows, and the loading / empty / error states. Each table
 * supplies only column defs (useDataTable) and its CSS class names, so the
 * look of every table is unchanged.
 *
 * Sort and resize use separate pointer targets: the sort button and the
 * resize handle are siblings inside the <th>, so a drag that ends over the
 * header can never click the sort button (T3, `ed703bf`).
 */
import {
  Fragment,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  flexRender,
  type Cell,
  type Header,
  type Row,
  type Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { nextSort } from "./useDataTable";
import { TableEmpty, TableError, TableLoading } from "./TableStates";

export interface DataTableProps<T> {
  table: Table<T>;
  ariaLabel: string;
  /** Class on the outer wrapper (each table's existing wrapper class). */
  className?: string;
  /** Class on the scroll container. */
  scrollClassName?: string;
  tableClassName?: string;
  /** Render only visible rows. Requires a fixed `rowHeight` (T5). */
  virtualize?: boolean;
  rowHeight?: number;
  /** Per-row props (class, inline style, e.g. a rider color border). */
  getRowProps?: (row: Row<T>) => {
    className?: string;
    style?: CSSProperties;
  };
  onRowClick?: (row: Row<T>) => void;
  /** Extra class for one cell (e.g. highlight the best value). */
  getCellClassName?: (cell: Cell<T, unknown>) => string | undefined;
  /** Content of the full-width row shown under an expanded row. */
  renderSubRow?: (row: Row<T>) => ReactNode;
  /** Extra leading header/cell (e.g. the chart-select toggle). */
  leadingHeader?: ReactNode;
  renderLeadingCell?: (row: Row<T>) => ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: ReactNode;
  /** Infinite scroll: called when the last row scrolls into view. */
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
  /** Number of skeleton rows while loading. */
  skeletonRows?: number;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    table,
    ariaLabel,
    className,
    scrollClassName,
    tableClassName,
    virtualize = false,
    rowHeight = 48,
    getRowProps,
    onRowClick,
    getCellClassName,
    renderSubRow,
    leadingHeader,
    renderLeadingCell,
    isLoading,
    error,
    onRetry,
    empty,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    skeletonRows = 8,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const { rows } = table.getRowModel();
  const columnCount =
    table.getVisibleLeafColumns().length +
    (leadingHeader !== undefined ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  // Infinite scroll: load the next page when the sentinel row is visible.
  useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, rows.length]);

  if (error) return <TableError error={error} onRetry={onRetry} />;
  if (!isLoading && rows.length === 0) return <>{empty ?? <TableEmpty />}</>;

  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const visibleRows = virtualize
    ? virtualItems.map((v) => rows[v.index]).filter(Boolean)
    : rows;
  const padTop =
    virtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const padBottom =
    virtualize && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        className={scrollClassName}
        style={{ flex: 1, overflow: "auto" }}
      >
        <table
          className={tableClassName}
          aria-label={ariaLabel}
          aria-rowcount={rows.length}
          style={{ minWidth: table.getTotalSize() }}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {leadingHeader !== undefined && leadingHeader}
                {group.headers.map((header) => (
                  <HeaderCell key={header.id} header={header} table={table} />
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <TableLoading rows={skeletonRows} columns={columnCount} />
            ) : (
              <>
                {padTop > 0 && <SpacerRow height={padTop} />}
                {visibleRows.map((row) => {
                  const extra = getRowProps?.(row) ?? {};
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={extra.className}
                        style={{
                          ...(virtualize ? { height: rowHeight } : {}),
                          ...(onRowClick ? { cursor: "pointer" } : {}),
                          ...extra.style,
                        }}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {renderLeadingCell?.(row)}
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={
                              [
                                cell.column.columnDef.meta?.className,
                                getCellClassName?.(cell),
                              ]
                                .filter(Boolean)
                                .join(" ") || undefined
                            }
                            style={{ minWidth: cell.column.getSize() }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                      {renderSubRow && row.getIsExpanded() && (
                        <tr className="data-table__sub-row">
                          <td colSpan={columnCount}>{renderSubRow(row)}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {padBottom > 0 && <SpacerRow height={padBottom} />}
                {hasNextPage && (
                  <tr ref={sentinelRef} className="data-table__more">
                    <td
                      colSpan={columnCount}
                      style={{ textAlign: "center", padding: "1rem" }}
                    >
                      {isFetchingNextPage ? (
                        <div
                          className="data-table__skeleton"
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
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={9999} style={{ height, padding: 0, border: "none" }} />
    </tr>
  );
}

function HeaderCell<T>({
  header,
  table,
}: {
  header: Header<T, unknown>;
  table: Table<T>;
}) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const canSort = column.getCanSort();
  const sorted = column.getIsSorted();
  const label = header.isPlaceholder
    ? null
    : flexRender(column.columnDef.header, header.getContext());

  const onSort = () => {
    const state = table.getState().sorting[0];
    const current = {
      sort: state?.id ?? "",
      dir: (state?.desc ? "desc" : "asc") as "asc" | "desc",
    };
    const next = nextSort(current, column.id, meta?.defaultDir);
    table.options.meta?.onSortChange?.(next.sort, next.dir);
  };

  return (
    <th
      data-column-id={column.id}
      className={
        [meta?.className, sorted ? "th--sorted" : ""]
          .filter(Boolean)
          .join(" ") || undefined
      }
      style={{ minWidth: header.getSize(), position: "relative" }}
      title={meta?.title}
      aria-sort={
        canSort
          ? sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : "none"
          : undefined
      }
    >
      {canSort ? (
        <button type="button" className="data-table__sort" onClick={onSort}>
          {label}
          <span
            className={`sort-indicator${sorted ? "" : " sort-indicator--placeholder"}`}
            aria-hidden="true"
          >
            {sorted === "asc" ? "▲" : "▼"}
          </span>
        </button>
      ) : (
        label
      )}
      {column.getCanResize() && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={() => column.resetSize()}
          className={`column-resizer${column.getIsResizing() ? " column-resizer--resizing" : ""}`}
        />
      )}
    </th>
  );
}
