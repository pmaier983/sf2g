import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { raceDays, seasonGrid } from "../race-season";
import type { RaceEvent, RacesFile } from "../races";

const DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/data/races-2027.json"), "utf8"),
) as RacesFile;
const byId = (id: string): RaceEvent => {
  const e = DATA.events.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};

describe("raceDays", () => {
  it("one-day race", () => {
    expect(raceDays(byId("patterson-pass-road-race-2027"))).toEqual([
      byId("patterson-pass-road-race-2027").start,
    ]);
  });
  it("stage race covers every day from start to end", () => {
    expect(raceDays(byId("redlands-bicycle-classic-2027"))).toEqual([
      "2027-04-07",
      "2027-04-08",
      "2027-04-09",
      "2027-04-10",
      "2027-04-11",
    ]);
  });
  it("series uses its listed dates", () => {
    expect(raceDays(byId("cbr-criterium-series-2027"))).toEqual([
      "2027-01-17",
      "2027-01-31",
      "2027-03-21",
      "2027-04-18",
      "2027-05-23",
      "2027-06-06",
    ]);
  });
  it("month-only and TBA events have no days", () => {
    expect(raceDays(byId("maverick-classic-2027"))).toEqual([]);
    expect(raceDays(DATA.events.find((e) => e.dateStatus === "tba")!)).toEqual(
      [],
    );
  });
});

describe("seasonGrid", () => {
  const grid = seasonGrid(2027, DATA.events);

  it("is 53 Monday-first weeks covering all of 2027", () => {
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    // Jan 1 2027 is a Friday → week 0, row 4 (Monday is row 0)
    expect(grid.weeks[0][4]).toMatchObject({ iso: "2027-01-01", inYear: true });
    expect(grid.weeks[0][3]).toMatchObject({
      iso: "2026-12-31",
      inYear: false,
    });
    const all = grid.weeks.flat();
    expect(all.filter((d) => d.inYear)).toHaveLength(365);
    expect(all.find((d) => d.iso === "2027-12-31")?.inYear).toBe(true);
  });

  it("puts each race on its days", () => {
    const day = (iso: string) => grid.weeks.flat().find((d) => d.iso === iso)!;
    const pp = byId("patterson-pass-road-race-2027");
    expect(day(pp.start!).events.map((e) => e.id)).toContain(pp.id);
    expect(day("2027-04-09").events.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "redlands-bicycle-classic-2027",
        "tour-of-newport-news-2027",
      ]),
    );
    expect(day("2027-01-31").events.map((e) => e.id)).toContain(
      "cbr-criterium-series-2027",
    );
  });

  it("labels each month at the week holding its 1st", () => {
    expect(grid.months.map((m) => m.label)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(grid.months[0].week).toBe(0);
    // Feb 1 2027 is a Monday in the 6th week
    expect(grid.months[1].week).toBe(5);
  });

  it("counts race-days and the events it could not place", () => {
    expect(grid.undated.map((e) => e.id)).toContain("maverick-classic-2027");
    expect(grid.undated.length).toBe(
      DATA.events.filter((e) => raceDays(e).length === 0).length,
    );
    expect(grid.maxPerDay).toBeGreaterThanOrEqual(2);
  });

  it("only includes the events it is given", () => {
    const one = seasonGrid(2027, [byId("patterson-pass-road-race-2027")]);
    expect(one.weeks.flat().filter((d) => d.events.length)).toHaveLength(1);
  });
});
