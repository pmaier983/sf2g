import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUMULATIVE_QUERY,
  parseCumulativeSearch,
  serializeCumulativeSearch,
} from "../segment-query";

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
    // In-app navigation passes the array itself.
    expect(parseCumulativeSearch({ set: "custom", seg: [5, 6] }).seg).toEqual([
      5, 6,
    ]);
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
