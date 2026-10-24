import { describe, expect, it } from "vitest";
import { fitHeaderSize, sortRows } from "../columns";
import { nextSort } from "../useDataTable";

describe("sortRows", () => {
  const rows = [
    { n: "a", w: 200 },
    { n: "b", w: null },
    { n: "c", w: 150 },
    { n: "d", w: undefined },
    { n: "e", w: 150 },
  ];
  const col = { accessorKey: "w" } as never;

  it("nulls last in both directions, stable ties", () => {
    expect(sortRows(rows, col, "desc").map((r) => r.n)).toEqual([
      "a",
      "c",
      "e",
      "b",
      "d",
    ]);
    expect(sortRows(rows, col, "asc").map((r) => r.n)).toEqual([
      "c",
      "e",
      "a",
      "b",
      "d",
    ]);
  });

  it("sorts strings case-insensitively and via accessorFn", () => {
    const names = [{ s: "bob" }, { s: "Ada" }, { s: "cy" }];
    expect(
      sortRows(
        names,
        { accessorFn: (r: { s: string }) => r.s } as never,
        "asc",
      ).map((r) => r.s),
    ).toEqual(["Ada", "bob", "cy"]);
  });

  it("leaves the order alone for display columns", () => {
    expect(sortRows(rows, { id: "x" } as never, "asc")).toEqual(rows);
  });
});

describe("nextSort", () => {
  it("flips the active column and starts new ones at their default", () => {
    expect(nextSort({ sort: "a", dir: "desc" }, "a")).toEqual({
      sort: "a",
      dir: "asc",
    });
    expect(nextSort({ sort: "a", dir: "asc" }, "a")).toEqual({
      sort: "a",
      dir: "desc",
    });
    expect(nextSort({ sort: "a", dir: "asc" }, "b")).toEqual({
      sort: "b",
      dir: "desc",
    });
    expect(nextSort({ sort: "a", dir: "desc" }, "b", "asc")).toEqual({
      sort: "b",
      dir: "asc",
    });
  });
});

describe("fitHeaderSize", () => {
  it("never narrower than the header text", () => {
    expect(fitHeaderSize({ header: "Rides", size: 200 })).toBe(200);
    expect(
      fitHeaderSize({ header: "Average Heart Rate (bpm)", size: 60 }),
    ).toBeGreaterThan(190);
  });
});
