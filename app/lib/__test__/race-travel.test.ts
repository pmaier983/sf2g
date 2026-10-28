import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIGIN,
  ORIGIN_PRESETS,
  estimateTravel,
  findOrigin,
  formatTravelTime,
  greatCircleMi,
  travelModeFor,
} from "../race-travel";
import type { RaceEvent, RacesFile } from "../races";

const DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/data/races-2027.json"), "utf8"),
) as RacesFile;
const byId = (id: string): RaceEvent => {
  const e = DATA.events.find((x) => x.id === id);
  if (!e) throw new Error(`no event ${id}`);
  return e;
};

describe("greatCircleMi", () => {
  it("SF City Hall to Patterson Pass is ~47 mi as the crow flies", () => {
    const e = byId("patterson-pass-road-race-2027");
    expect(
      greatCircleMi(DEFAULT_ORIGIN, { lat: e.lat!, lng: e.lng! }),
    ).toBeCloseTo(47, 0);
  });
  it("is zero for the same point", () => {
    expect(greatCircleMi(DEFAULT_ORIGIN, DEFAULT_ORIGIN)).toBe(0);
  });
});

describe("travelModeFor", () => {
  it.each([
    [3, 9, "bike"],
    [25, 40, "bike"],
    [26, 40, "drive"],
    [237, 240, "drive"],
    [273, 329, "overnight"],
    [600, 650, "overnight"],
    [601, 660, "flight"],
  ] as const)("%s road mi / %s min → %s", (mi, min, mode) => {
    expect(travelModeFor(mi, min)).toBe(mode);
  });
});

describe("estimateTravel", () => {
  it("from SF uses the exact OSRM drive figures", () => {
    const e = byId("patterson-pass-road-race-2027");
    const t = estimateTravel(e, DEFAULT_ORIGIN)!;
    expect(t).toMatchObject({
      mode: "drive",
      roadMi: e.drive!.mi,
      minutes: e.drive!.min,
      estimated: false,
    });
  });

  it("from SF: Il Giro is a bike ride, Redlands an overnight drive, Tucson a flight", () => {
    expect(
      estimateTravel(byId("il-giro-di-san-francisco-2027"), DEFAULT_ORIGIN)!
        .mode,
    ).toBe("bike");
    expect(
      estimateTravel(byId("redlands-bicycle-classic-2027"), DEFAULT_ORIGIN)!
        .mode,
    ).toBe("overnight");
    expect(
      estimateTravel(byId("tucson-bicycle-classic-2027"), DEFAULT_ORIGIN)!.mode,
    ).toBe("flight");
  });

  it("bike minutes assume ~14 mph on the road distance", () => {
    const t = estimateTravel(
      byId("il-giro-di-san-francisco-2027"),
      DEFAULT_ORIGIN,
    )!;
    expect(t.minutes).toBe(Math.round((3 / 14) * 60));
  });

  it("from another origin, estimates road miles and drive time within ~15% of OSRM", () => {
    // Pretend the SF City Hall origin is not exact: the model must still
    // land close to the OSRM numbers for every event with a drive.
    const sfEstimated = { ...DEFAULT_ORIGIN, exact: false };
    for (const e of DATA.events) {
      if (!e.drive || e.drive.mi < 20) continue;
      const t = estimateTravel(e, sfEstimated)!;
      expect(t.estimated).toBe(true);
      expect(Math.abs(t.roadMi - e.drive.mi) / e.drive.mi, e.id).toBeLessThan(
        0.15,
      );
    }
  });

  it("from Los Angeles, Redlands becomes a day drive and Patterson Pass an overnight", () => {
    const la = findOrigin("Los Angeles")!;
    expect(
      estimateTravel(byId("redlands-bicycle-classic-2027"), la)!.mode,
    ).toBe("drive");
    expect(
      estimateTravel(byId("patterson-pass-road-race-2027"), la)!.mode,
    ).toBe("overnight");
  });

  it("flight time adds airport overhead to air time", () => {
    const t = estimateTravel(
      byId("green-mountain-stage-race-2027"),
      DEFAULT_ORIGIN,
    )!;
    expect(t.mode).toBe("flight");
    expect(t.estimated).toBe(true);
    // ~2,585 mi at 450 mph ≈ 345 min, plus 150 min overhead
    expect(t.minutes).toBeGreaterThan(450);
    expect(t.minutes).toBeLessThan(540);
  });

  it("returns null for events without a venue", () => {
    expect(estimateTravel(byId("go-fast-criterium-2027"), DEFAULT_ORIGIN)).toBe(
      null,
    );
  });
});

describe("findOrigin", () => {
  it("matches presets case-insensitively", () => {
    expect(findOrigin("oakland")?.label).toBe("Oakland");
    expect(findOrigin("  San Francisco ")).toEqual(DEFAULT_ORIGIN);
  });
  it("parses typed coordinates", () => {
    expect(findOrigin("37.5, -122.25")).toMatchObject({
      lat: 37.5,
      lng: -122.25,
      exact: false,
    });
  });
  it("rejects unknown text and impossible coordinates", () => {
    expect(findOrigin("Atlantis")).toBeNull();
    expect(findOrigin("")).toBeNull();
    expect(findOrigin("137, 20")).toBeNull();
  });
  it("only San Francisco claims exact drive data", () => {
    expect(ORIGIN_PRESETS.filter((o) => o.exact).map((o) => o.label)).toEqual([
      "San Francisco",
    ]);
  });
});

describe("formatTravelTime", () => {
  it("formats minutes, hours, and marks estimates", () => {
    expect(formatTravelTime(13, false)).toBe("13 min");
    expect(formatTravelTime(111, false)).toBe("1 h 51");
    expect(formatTravelTime(111, true)).toBe("~1 h 51");
    expect(formatTravelTime(47, true)).toBe("~47 min");
  });
});
