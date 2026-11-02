import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  courseCaption,
  formatDistance,
  filterAndSortRaces,
  formatDateRange,
  formatDriveMinutes,
  isLikelyFlight,
  mapGeometry,
  parseRacesSearch,
  profileGeometry,
  profileSpanFt,
  sectionCounts,
  sourceEntries,
  summarizeRaces,
  type RaceCourse,
  type RaceEvent,
  type RacesFile,
} from "../races";

const DATA = JSON.parse(
  readFileSync(
    new URL("../../../public/data/races-2027.json", import.meta.url),
    "utf8",
  ),
) as RacesFile;
const EVENTS = DATA.events;

const byId = (id: string): RaceEvent => {
  const e = EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};

describe("races-2027.json (the static asset the page renders)", () => {
  it("has 65 events: 27 NorCal, 14 SoCal, 24 stage races", () => {
    expect(EVENTS).toHaveLength(65);
    expect(sectionCounts(EVENTS)).toEqual({
      all: 65,
      norcal: 27,
      socal: 14,
      stage: 24,
    });
  });

  it("maps 36 California courses; 5 SoCal events have no GPS file", () => {
    const ca = EVENTS.filter((e) => e.section !== "stage");
    expect(ca.filter((e) => e.course)).toHaveLength(36);
    const missing = ca.filter((e) => !e.course);
    expect(missing).toHaveLength(5);
    expect(missing.every((e) => e.section === "socal")).toBe(true);
  });

  it("header counts", () => {
    expect(summarizeRaces(EVENTS)).toEqual({
      californiaEvents: 41,
      californiaRoadRaces: 10,
      stageRacesDated: 13,
      coursesMapped: 36,
    });
  });

  it("every event has at least one source, and every TBA event is a stage race", () => {
    for (const e of EVENTS) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      expect(sourceEntries(e).length, e.id).toBeGreaterThanOrEqual(1);
    }
    const tba = EVENTS.filter((e) => e.dateStatus === "tba");
    expect(tba).toHaveLength(11);
    expect(tba.every((e) => e.section === "stage" && e.start === null)).toBe(
      true,
    );
    expect(tba.every((e) => e.previousEdition)).toBe(true);
  });

  it("has no personal wording", () => {
    const raw = readFileSync(
      new URL("../../../public/data/races-2027.json", import.meta.url),
      "utf8",
    );
    expect(raw).not.toMatch(/\b(you|your)\b/i);
  });

  it.each([
    ["patterson-pass-road-race-2027", 22.1, 1990],
    ["los-gatos-roofing-cat-s-hill-classic-2027", 0.9, 80],
    ["copperopolis-road-race-2027", 21.8, 1370],
  ])("spot check %s: ~%s mi, ~%s ft per lap", (id, mi, ft) => {
    const c = byId(id).course;
    expect(c).not.toBeNull();
    expect(c!.lapMi).toBeCloseTo(mi, 0);
    expect(Math.abs(c!.lapGainFt - ft)).toBeLessThanOrEqual(30);
  });
});

describe("filterAndSortRaces", () => {
  it("defaults: everything dated by start, TBA separately by drive", () => {
    const { dated, tba } = filterAndSortRaces(EVENTS, parseRacesSearch({}));
    expect(dated.length + tba.length).toBe(65);
    expect(tba).toHaveLength(11);
    for (let i = 1; i < dated.length; i++) {
      expect(dated[i - 1].start! <= dated[i].start!).toBe(true);
    }
    for (let i = 1; i < tba.length; i++) {
      expect(
        (tba[i - 1].drive?.mi ?? Infinity) <= (tba[i].drive?.mi ?? Infinity),
      ).toBe(true);
    }
  });

  it("section + type filters narrow the list", () => {
    const norcalRR = filterAndSortRaces(EVENTS, {
      section: "norcal",
      type: "Road race",
      sort: "date",
      terrain: "all",
    });
    expect(norcalRR.dated.length).toBeGreaterThan(0);
    expect(norcalRR.tba).toHaveLength(0);
    expect(
      norcalRR.dated.every(
        (e) => e.section === "norcal" && e.type === "Road race",
      ),
    ).toBe(true);

    // Stage races are their own type, so a type filter hides them.
    const stageCrits = filterAndSortRaces(EVENTS, {
      section: "stage",
      type: "Crit",
      sort: "date",
      terrain: "all",
    });
    expect(stageCrits.dated).toHaveLength(0);
    expect(stageCrits.tba).toHaveLength(0);
  });

  it("sort by drive puts the nearest event first", () => {
    const { dated } = filterAndSortRaces(EVENTS, {
      section: "all",
      type: "all",
      sort: "drive",
      terrain: "all",
    });
    for (let i = 1; i < dated.length; i++) {
      expect(
        (dated[i - 1].drive?.mi ?? Infinity) <=
          (dated[i].drive?.mi ?? Infinity),
      ).toBe(true);
    }
  });
});

describe("parseRacesSearch", () => {
  it("falls back to defaults for unknown values", () => {
    expect(parseRacesSearch({})).toEqual({
      section: "all",
      type: "all",
      sort: "date",
      terrain: "all",
    });
    expect(
      parseRacesSearch({
        section: "mars",
        type: 3,
        sort: "bogus",
        terrain: "alps",
      }),
    ).toEqual({ section: "all", type: "all", sort: "date", terrain: "all" });
    expect(
      parseRacesSearch({
        section: "socal",
        type: "Crit",
        sort: "hilliest",
        terrain: "climb",
      }),
    ).toEqual({
      section: "socal",
      type: "Crit",
      sort: "hilliest",
      terrain: "climb",
    });
  });
});

describe("formatting", () => {
  it("drive minutes", () => {
    expect(formatDriveMinutes(111)).toBe("1 h 51");
    expect(formatDriveMinutes(60)).toBe("1 h 00");
    expect(formatDriveMinutes(947)).toBe("15 h 47");
  });

  it("date ranges", () => {
    expect(formatDateRange("2026-06-05", "2026-06-05")).toBe("Jun 5");
    expect(formatDateRange("2026-06-05", "2026-06-07")).toBe("Jun 5–7");
    expect(formatDateRange("2026-06-30", "2026-07-01")).toBe("Jun 30 – Jul 1");
  });

  it("course caption", () => {
    const c = byId("patterson-pass-road-race-2027").course!;
    expect(courseCaption(c)).toMatch(
      /^One lap · 22\.\d+ mi · \+1,\d{3} ft · [\d,]+–[\d,]+ ft$/,
    );
  });

  it("likely a flight over 600 mi", () => {
    expect(isLikelyFlight({ mi: 600 })).toBe(false);
    expect(isLikelyFlight({ mi: 601 })).toBe(true);
    expect(isLikelyFlight(null)).toBe(false);
  });

  it("sources line adds Route, Elevation and Drive entries", () => {
    const whats = sourceEntries(byId("cal-aggie-criterium-2027")).map(
      (s) => s.what,
    );
    expect(whats).toEqual(["Date & venue", "Route", "Elevation", "Drive"]);
    // A stage race without a course only gets Drive added.
    const stage = EVENTS.find((e) => e.section === "stage" && e.drive)!;
    expect(sourceEntries(stage).map((s) => s.what)).not.toContain("Route");
    expect(sourceEntries(stage).at(-1)?.what).toBe("Drive");
  });
});

describe("SVG geometry", () => {
  it("map fits inside the box and starts at the first point", () => {
    const c = byId("patterson-pass-road-race-2027").course!;
    const g = mapGeometry(c.path, 64, 5);
    expect(g.d.startsWith("M")).toBe(true);
    const nums = g.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...nums)).toBeLessThanOrEqual(59);
    expect(
      g.d.startsWith(`M${g.start.x.toFixed(1)} ${g.start.y.toFixed(1)}`),
    ).toBe(true);
  });

  it("profile span keeps flat crits flat", () => {
    expect(profileSpanFt({ minFt: 14, maxFt: 24, lapMi: 1.1 })).toBe(60);
    expect(profileSpanFt({ minFt: 100, maxFt: 200, lapMi: 20 })).toBe(300);
    expect(profileSpanFt({ minFt: 100, maxFt: 2000, lapMi: 20 })).toBe(1900);
  });

  it("profile line spans the full width and stays inside the box", () => {
    const c: RaceCourse = {
      lapMi: 1,
      lapGainFt: 10,
      minFt: 0,
      maxFt: 10,
      profileFt: [0, 5, 10, 5, 0],
      path: [
        [0, 0],
        [1, 1],
      ],
      pathSource: { label: "x", url: null },
      elevationSource: { label: "y", url: "https://example.com" },
    };
    const g = profileGeometry(c, 100, 64, 4);
    expect(g.spanFt).toBe(60);
    expect(g.line).toBe(
      "M0.0 60.0 L25.0 55.3 L50.0 50.7 L75.0 55.3 L100.0 60.0",
    );
    expect(g.area.endsWith("L100 64 L0 64 Z")).toBe(true);
  });
});

describe("units (MI/KM switcher)", () => {
  it("course caption in km and metres", () => {
    const c = EVENTS.find(
      (e) => e.id === "patterson-pass-road-race-2027",
    )!.course!;
    expect(courseCaption(c, "mi")).toBe(
      "One lap · 22.14 mi · +1,990 ft · 242–1,552 ft",
    );
    expect(courseCaption(c, "km")).toBe(
      "One lap · 35.6 km · +607 m · 74–473 m",
    );
  });

  it("short laps keep two decimals in km", () => {
    const c = EVENTS.find(
      (e) => e.id === "los-gatos-roofing-cat-s-hill-classic-2027",
    )!.course!;
    expect(courseCaption(c, "km")).toBe(
      "One lap · 1.45 km · +24 m · 123–141 m",
    );
  });

  it("formatDistance converts road miles", () => {
    expect(formatDistance(89, "mi")).toEqual({ value: "89", unit: "mi" });
    expect(formatDistance(89, "km")).toEqual({ value: "143", unit: "km" });
    expect(formatDistance(2923, "km")).toEqual({ value: "4,704", unit: "km" });
  });
});

describe("terrain filter and the extra sorts", () => {
  const base = { section: "all", type: "all", terrain: "all" } as const;
  const ids = (es: RaceEvent[]) => es.map((e) => e.id);

  it("terrain=climb keeps only the one-big-climb courses", () => {
    const { dated, tba } = filterAndSortRaces(EVENTS, {
      ...base,
      sort: "date",
      terrain: "climb",
    });
    expect(ids(dated).sort()).toEqual([
      "copperopolis-road-race-2027",
      "patterson-pass-road-race-2027",
      "winters-road-race-2027",
    ]);
    expect(tba).toHaveLength(0);
  });

  it("terrain filters drop events without a course profile", () => {
    for (const terrain of ["flat", "hilly", "climb"] as const) {
      const { dated } = filterAndSortRaces(EVENTS, {
        ...base,
        sort: "date",
        terrain,
      });
      expect(dated.every((e) => e.course)).toBe(true);
    }
  });

  it("hilliest: steepest climbing per mile first, no-profile events last", () => {
    const { dated } = filterAndSortRaces(EVENTS, { ...base, sort: "hilliest" });
    expect(dated[0].id).toBe("winchester-circuit-race-2027");
    expect(dated[1].id).toBe("patterson-pass-road-race-2027");
    const firstNoCourse = dated.findIndex((e) => !e.course);
    expect(dated.slice(firstNoCourse).every((e) => !e.course)).toBe(true);
  });

  it("flattest is the reverse, still with no-profile events last", () => {
    const { dated } = filterAndSortRaces(EVENTS, { ...base, sort: "flattest" });
    const withCourse = dated.filter((e) => e.course);
    expect(withCourse.at(-1)!.id).toBe("winchester-circuit-race-2027");
    expect(dated.at(-1)!.course).toBeNull();
  });

  it("biggest climb puts Patterson Pass first", () => {
    const { dated } = filterAndSortRaces(EVENTS, { ...base, sort: "climb" });
    expect(dated[0].id).toBe("patterson-pass-road-race-2027");
  });

  it("quickest trip uses the supplied travel minutes", () => {
    const { dated } = filterAndSortRaces(
      EVENTS,
      { ...base, sort: "time" },
      { minutesOf: (e) => (e.id === "tour-de-bloom-2027" ? 1 : 1000) },
    );
    expect(dated[0].id).toBe("tour-de-bloom-2027");
  });

  it("name sorts A–Z", () => {
    const { dated } = filterAndSortRaces(EVENTS, { ...base, sort: "name" });
    const names = dated.map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });
});
