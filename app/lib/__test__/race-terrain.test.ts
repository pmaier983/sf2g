import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  biggestClimbFt,
  climbingPerMile,
  courseTerrain,
  formatClimbingRate,
} from "../race-terrain";
import type { RaceCourse, RaceEvent, RacesFile } from "../races";

const DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/data/races-2027.json"), "utf8"),
) as RacesFile;
const course = (id: string): RaceCourse => {
  const e = DATA.events.find((x: RaceEvent) => x.id === id);
  if (!e?.course) throw new Error(`no course ${id}`);
  return e.course;
};

describe("courseTerrain", () => {
  it.each([
    "patterson-pass-road-race-2027",
    "copperopolis-road-race-2027",
    "winters-road-race-2027",
  ])("%s is one big climb", (id) => {
    expect(courseTerrain(course(id)).kind).toBe("climb");
  });

  it.each([
    // several climbs, none dominant
    "avrt-pescadero-road-race-2027",
    "berkeley-hills-road-race-2027",
    "winchester-circuit-race-2027",
    "santa-barbara-county-rr-2027",
    // climber's crits
    "los-gatos-roofing-cat-s-hill-classic-2027",
    "santa-cruz-classic-criterium-2027",
  ])("%s is hilly", (id) => {
    expect(courseTerrain(course(id)).kind).toBe("hilly");
  });

  it.each([
    "cal-aggie-criterium-2027",
    "dash-for-cash-2027",
    "uc-davis-flatlands-circuit-2027",
    "sgw-bariani-road-race-2027",
    "regalado-road-race-2027",
    "cantua-creek-road-race-2027",
    "copper-valley-circuit-race-2027",
    // one small rise per lap is still a flat crit
    "il-giro-di-san-francisco-2027",
    "montage-wellness-sand-city-criterium-2027",
    "berkeley-streets-criterium-2027",
  ])("%s is flat", (id) => {
    expect(courseTerrain(course(id)).kind).toBe("flat");
  });

  it("classifies every mapped course, mostly flat with a few hard ones", () => {
    const kinds = DATA.events
      .filter((e) => e.course)
      .map((e) => courseTerrain(e.course!).kind);
    expect(kinds).toHaveLength(36);
    expect(kinds.filter((k) => k === "climb")).toHaveLength(3);
    expect(kinds.filter((k) => k === "hilly")).toHaveLength(6);
    expect(kinds.filter((k) => k === "flat")).toHaveLength(27);
  });
});

describe("metrics", () => {
  it("climbing per mile", () => {
    expect(climbingPerMile(course("patterson-pass-road-race-2027"))).toBe(90);
    expect(climbingPerMile(course("cal-aggie-criterium-2027"))).toBe(14);
  });

  it("biggest climb is a sustained rise, never more than the lap's range", () => {
    const c = course("patterson-pass-road-race-2027");
    const b = biggestClimbFt(c.profileFt);
    expect(b).toBeGreaterThan(1000);
    expect(b).toBeLessThanOrEqual(c.maxFt - c.minFt);
    // A single bump: 0 → 100 → 0
    expect(biggestClimbFt([0, 50, 100, 50, 0])).toBe(100);
    // Two climbs split by a real descent count separately
    expect(biggestClimbFt([0, 100, 40, 120, 0])).toBe(100);
    // A small dip does not end a climb
    expect(biggestClimbFt([0, 100, 90, 200])).toBe(200);
  });

  it("formats climbing rate per unit", () => {
    expect(formatClimbingRate(90, "mi")).toBe("90 ft/mi");
    expect(formatClimbingRate(90, "km")).toBe("17 m/km");
  });
});
