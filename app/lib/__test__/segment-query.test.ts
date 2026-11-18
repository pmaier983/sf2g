import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUMULATIVE_QUERY,
  DEFAULT_SEGMENT_QUERY,
  parseCumulativeSearch,
  serializeCumulativeSearch,
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

describe("CumulativeQuery (phase 09)", () => {
  it("defaults", () => {
    expect(parseCumulativeSearch({})).toEqual(DEFAULT_CUMULATIVE_QUERY);
    expect(serializeCumulativeSearch(DEFAULT_CUMULATIVE_QUERY)).toEqual({});
  });

  it("garbage falls back field by field", () => {
    expect(
      parseCumulativeSearch({
        corridor: "nope",
        direction: "up",
        year: "abc",
        set: "x",
        min: "-3",
        seg: "1,a,2",
        view: "z",
      }),
    ).toEqual(DEFAULT_CUMULATIVE_QUERY);
  });

  it("custom keeps ids; other sets drop them", () => {
    expect(
      parseCumulativeSearch({ set: "custom", seg: "12, 7,x" }).seg,
    ).toEqual([12, 7]);
    expect(parseCumulativeSearch({ set: "climbs", seg: "12" }).seg).toEqual([]);
  });

  it("swaps an inverted length range and rounds to 0.1 km", () => {
    const q = parseCumulativeSearch({ min: "5.04", max: "1" });
    expect([q.min, q.max]).toEqual([1, 5]);
  });

  it("round-trips through the URL form", () => {
    const q = parseCumulativeSearch({
      year: 2025,
      set: "custom",
      seg: "3,4",
      min: 0.5,
      overlap: "1",
      view: "segments",
      direction: "north",
    });
    expect(parseCumulativeSearch(serializeCumulativeSearch(q))).toEqual(q);
    expect(serializeCumulativeSearch(q)).toEqual({
      direction: "north",
      year: 2025,
      set: "custom",
      min: 0.5,
      seg: "3,4",
      overlap: 1,
      view: "segments",
    });
  });
});
