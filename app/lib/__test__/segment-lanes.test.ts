import { describe, expect, it } from "vitest";
import { packLanes, placeSegments, type Bar } from "../segment-lanes";
import profile from "../../test/fixtures/corridor-profile.json";
import type { CorridorProfile } from "../corridor-profile";

const p = profile as CorridorProfile;

function overlaps(a: Bar, b: Bar): boolean {
  return a.startM < b.endM && b.startM < a.endM;
}

describe("packLanes", () => {
  const bars: Bar[] = [
    { id: 1, startM: 0, endM: 1000 },
    { id: 2, startM: 500, endM: 1500 },
    { id: 3, startM: 1000, endM: 2000 },
    { id: 4, startM: 200, endM: 300 },
    { id: 5, startM: 1600, endM: 1700 },
  ];

  it("never puts two overlapping bars in one lane", () => {
    const placed = packLanes(bars);
    expect(placed).toHaveLength(bars.length);
    for (const a of placed)
      for (const b of placed)
        if (a.id !== b.id && a.lane === b.lane)
          expect(overlaps(a, b)).toBe(false);
  });

  it("a bar starting exactly where another ends shares its lane", () => {
    const placed = packLanes(bars);
    const lane = (id: number) => placed.find((b) => b.id === id)!.lane;
    expect(lane(3)).toBe(lane(1));
  });

  it("greedy by start: first free lane, in a deterministic order", () => {
    expect(packLanes(bars).map((b) => [b.id, b.lane])).toEqual([
      [1, 0],
      [4, 1],
      [2, 1], // lane 1 is free again once 4 ends at 300
      [3, 0],
      [5, 1],
    ]);
    expect(packLanes([...bars].reverse())).toEqual(packLanes(bars));
  });
});

describe("placeSegments", () => {
  const at = (i: number) => p.latlng[i];

  it("positions segments along the profile, north ones by their extent", () => {
    const placed = placeSegments(
      [
        { id: 10, start_latlng: at(2), end_latlng: at(12) },
        { id: 11, start_latlng: at(8), end_latlng: at(20) },
        { id: 12, start_latlng: at(30), end_latlng: at(25) }, // northbound
      ],
      p,
    );
    const byId = Object.fromEntries(placed.map((b) => [b.id, b]));
    for (const b of placed) expect(b.startM).toBeLessThan(b.endM);
    expect(byId[10].startM).toBeCloseTo(p.distance[2], 0);
    expect(byId[10].endM).toBeCloseTo(p.distance[12], 0);
    expect(byId[12].startM).toBeCloseTo(p.distance[25], 0);
    expect(byId[12].endM).toBeCloseTo(p.distance[30], 0);
    expect([byId[10].lane, byId[11].lane, byId[12].lane]).toEqual([0, 1, 0]);
  });
});
