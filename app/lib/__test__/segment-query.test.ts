import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_QUERY,
  parseSegmentSearch,
  serializeSegmentSearch,
  toSegmentSqlParams,
} from "../segment-query";

describe("parseSegmentSearch", () => {
  it("gives defaults for an empty search", () => {
    expect(parseSegmentSearch({})).toEqual({
      corridor: "skyline",
      terrain: "all",
      direction: "south",
      range: "all",
      top: 10,
    });
    expect(parseSegmentSearch(undefined)).toEqual(DEFAULT_SEGMENT_QUERY);
  });

  it("keeps valid values", () => {
    expect(
      parseSegmentSearch({
        terrain: "climb",
        direction: "both",
        range: "this-year",
        top: "25",
      }),
    ).toEqual({
      corridor: "skyline",
      terrain: "climb",
      direction: "both",
      range: "this-year",
      top: 25,
    });
  });

  it("falls back per field on garbage", () => {
    expect(
      parseSegmentSearch({
        corridor: "bayway",
        terrain: "descent",
        direction: "east",
        range: "forever",
        top: 999,
      }),
    ).toEqual(DEFAULT_SEGMENT_QUERY);
    expect(parseSegmentSearch({ top: "x", terrain: "flat" })).toEqual({
      ...DEFAULT_SEGMENT_QUERY,
      terrain: "flat",
    });
    expect(parseSegmentSearch({ top: 0 }).top).toBe(10);
    expect(parseSegmentSearch({ top: 2.5 }).top).toBe(10);
  });
});

describe("serializeSegmentSearch", () => {
  it("drops defaults", () => {
    expect(serializeSegmentSearch(DEFAULT_SEGMENT_QUERY)).toEqual({});
    expect(
      serializeSegmentSearch({
        ...DEFAULT_SEGMENT_QUERY,
        terrain: "climb",
        range: "last-30-days",
      }),
    ).toEqual({ terrain: "climb", range: "last-30-days" });
  });

  it("round-trips", () => {
    const q = parseSegmentSearch({ direction: "north", top: 5 });
    expect(parseSegmentSearch(serializeSegmentSearch(q))).toEqual(q);
  });
});

describe("toSegmentSqlParams", () => {
  it("all time has no dates", () => {
    expect(toSegmentSqlParams(DEFAULT_SEGMENT_QUERY)).toEqual({
      corridor: "skyline",
      terrain: "all",
      direction: "south",
      date_from: null,
      date_to: null,
      top: 10,
      min_riders: 3,
    });
  });

  it("resolves this-year in LA time", () => {
    // 07:30 UTC on Jan 1 is still Dec 31 in Los Angeles.
    const now = new Date("2026-01-01T07:30:00Z");
    expect(
      toSegmentSqlParams({ ...DEFAULT_SEGMENT_QUERY, range: "this-year" }, now),
    ).toMatchObject({ date_from: "2025-01-01", date_to: "2025-12-31" });
    const later = new Date("2026-10-16T19:00:00Z");
    expect(
      toSegmentSqlParams(
        { ...DEFAULT_SEGMENT_QUERY, range: "this-year" },
        later,
      ),
    ).toMatchObject({ date_from: "2026-01-01", date_to: "2026-10-16" });
  });
});
