/**
 * The shared table shell: sorting, resizing (T3), virtualization (T5),
 * header widths (T4) and the empty / error / loading states.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type DataTableProps } from "../DataTable";
import { useDataTable, type SortDir } from "../useDataTable";

interface Row {
  id: string;
  name: string;
  rides: number;
  watts: number | null;
}

const COLUMNS: ColumnDef<Row, any>[] = [
  { accessorKey: "name", header: "Rider", meta: { defaultDir: "asc" } },
  { accessorKey: "rides", header: "Rides" },
  { accessorKey: "watts", header: "Avg Watts" },
  {
    id: "note",
    header: "A very long column header",
    enableSorting: false,
    cell: () => "–",
  },
];

const ROWS: Row[] = [
  { id: "a", name: "Ada", rides: 3, watts: 200 },
  { id: "b", name: "Bo", rides: 9, watts: null },
  { id: "c", name: "Cy", rides: 5, watts: 150 },
];

function Harness({
  rows = ROWS,
  clientSort = true,
  onSort,
  ...props
}: {
  rows?: Row[];
  clientSort?: boolean;
  onSort?: (s: string, d: SortDir) => void;
} & Partial<DataTableProps<Row>>) {
  const [sort, setSort] = useState({ sort: "rides", dir: "desc" as SortDir });
  const table = useDataTable({
    data: rows,
    columns: COLUMNS,
    sort: sort.sort,
    dir: sort.dir,
    sortClientSide: clientSort,
    getRowId: (r) => r.id,
    onSortChange: (s, d) => {
      onSort?.(s, d);
      setSort({ sort: s, dir: d });
    },
  });
  return <DataTable table={table} ariaLabel="Test table" {...props} />;
}

const header = (name: string) =>
  screen.getByRole("columnheader", { name: new RegExp(name) });
const firstColumn = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("DataTable", () => {
  it("renders rows in the sorted order and marks the sorted column", () => {
    render(<Harness />);
    expect(firstColumn()).toEqual(["Bo", "Cy", "Ada"]);
    expect(header("Rides")).toHaveAttribute("aria-sort", "descending");
    expect(header("Rider")).toHaveAttribute("aria-sort", "none");
    expect(header("A very long")).not.toHaveAttribute("aria-sort");
  });

  it("click flips the sorted column; another column starts at its default dir", () => {
    const onSort = vi.fn();
    render(<Harness onSort={onSort} />);
    fireEvent.click(within(header("Rides")).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("rides", "asc");
    expect(header("Rides")).toHaveAttribute("aria-sort", "ascending");

    fireEvent.click(within(header("Rider")).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith("name", "asc");
    expect(firstColumn()).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("puts empty values last in both directions (T6)", () => {
    render(<Harness />);
    const watts = within(header("Avg Watts")).getByRole("button");
    fireEvent.click(watts); // desc
    expect(firstColumn()).toEqual(["Ada", "Cy", "Bo"]);
    fireEvent.click(watts); // asc
    expect(firstColumn()).toEqual(["Cy", "Ada", "Bo"]);
  });

  it("resizing a column does not change the sort (T3)", () => {
    const onSort = vi.fn();
    render(<Harness onSort={onSort} />);
    const th = header("Rider");
    const handle = within(th).getByRole("separator");
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 160 });
    fireEvent.mouseUp(th, { clientX: 160 });
    fireEvent.click(th); // the click a drag ending over the header produces
    fireEvent.click(handle);
    expect(onSort).not.toHaveBeenCalled();
    expect(header("Rides")).toHaveAttribute("aria-sort", "descending");
  });

  it("default widths fit the header text (T4)", () => {
    render(<Harness />);
    const width = parseInt(header("A very long").style.minWidth, 10);
    expect(width).toBeGreaterThanOrEqual(
      "A very long column header".length * 8,
    );
  });

  it("virtualizes large tables with a fixed row height (T5)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      id: String(i),
      name: `Rider ${i}`,
      rides: i,
      watts: null,
    }));
    render(
      <Harness rows={many} clientSort={false} virtualize rowHeight={48} />,
    );
    const rendered = screen
      .getAllByRole("row")
      .filter((r) => !r.getAttribute("aria-hidden"));
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.length).toBeLessThan(100);
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "10000");
    expect(rendered[1].style.height).toBe("48px");
  });

  it("shows the empty state for no rows", () => {
    render(<Harness rows={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Nothing to show");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the error with a retry button", () => {
    const onRetry = vi.fn();
    render(<Harness error={new Error("boom")} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows skeleton rows while loading", () => {
    const { container } = render(
      <Harness rows={[]} isLoading skeletonRows={4} />,
    );
    expect(
      container.querySelectorAll(".data-table__skeleton-row"),
    ).toHaveLength(4);
  });

  it("renders an expanded row's sub-row", () => {
    function Expandable() {
      const table = useDataTable({
        data: ROWS,
        columns: COLUMNS,
        sort: "rides",
        dir: "desc",
        onSortChange: () => {},
        getRowId: (r) => r.id,
        getRowCanExpand: () => true,
      });
      return (
        <DataTable
          table={table}
          ariaLabel="x"
          onRowClick={(row) => row.toggleExpanded()}
          renderSubRow={(row) => `details for ${row.original.name}`}
        />
      );
    }
    render(<Expandable />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("details for Ada")).toBeInTheDocument();
  });
});
