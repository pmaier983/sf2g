import { describe, expect, it } from "vitest";
import { aggregateByYear } from "../RideFrequencyChart";
import type { ProfileRide } from "../../lib/database.types";

const ride = (ride_date: string, route_category: string | null) =>
  ({ ride_date, route_category }) as unknown as ProfileRide;

describe("aggregateByYear", () => {
  it("has a bar for every year from the first ride to this year, gaps included", () => {
    const years = aggregateByYear(
      [
        ride("2012-05-01", "bayway"),
        ride("2015-06-01", "skyline"),
        ride("2015-06-02", "skyline"),
      ],
      2017,
    );
    expect(years.map((y) => y.year)).toEqual([
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
    ]);
    expect(years.find((y) => y.year === "2013")).toMatchObject({
      bayway: 0,
      skyline: 0,
    });
    expect(years.find((y) => y.year === "2015")?.skyline).toBe(2);
  });

  it("is empty with no rides", () => {
    expect(aggregateByYear([], 2026)).toEqual([]);
  });
});

describe("monthRange", () => {
  it("covers every month, across years", async () => {
    const { monthRange } = await import("../ProfileFunStats");
    expect(monthRange("2019-11", "2020-02")).toEqual([
      "2019-11",
      "2019-12",
      "2020-01",
      "2020-02",
    ]);
    expect(monthRange("2026-10", "2026-10")).toEqual(["2026-10"]);
  });
});
