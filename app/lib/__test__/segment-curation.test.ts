import { describe, expect, it } from "vitest";
import { curateSegments, type CurationCandidate } from "../segment-curation";

let nextId = 1;
function seg(over: Partial<CurationCandidate> = {}): CurationCandidate {
  return {
    id: nextId++,
    name: "s",
    distance_meters: 1000,
    average_grade: 3,
    terrain: "climb",
    direction: "south",
    along_start_m: 10_000,
    along_end_m: 11_000,
    in_core: true,
    hazardous: false,
    hidden: false,
    curated_rank: null,
    athlete_count: 1000,
    sf2g_rides: 90,
    selectable: false,
    duplicate_of: null,
    ride_share: 0.9,
    ...over,
  };
}
const selected = (r: ReturnType<typeof curateSegments>) =>
  r.rows.filter((x) => x.selectable).map((x) => x.id);

describe("curateSegments", () => {
  it("keeps core, non-descent, long enough, visible, safe segments", () => {
    const ok = seg();
    const out = [
      seg({ in_core: false }),
      seg({ terrain: "descent", average_grade: -4 }),
      seg({ distance_meters: 250 }),
      seg({ hidden: true }),
      seg({ hazardous: true }),
      seg({ along_start_m: null, along_end_m: null }),
    ];
    expect(selected(curateSegments([ok, ...out]))).toEqual([ok.id]);
  });

  it("treats near-identical segments as duplicates and keeps the most ridden", () => {
    const a = seg({ ride_share: 0.8 });
    const b = seg({
      along_start_m: 10_100,
      along_end_m: 10_950,
      ride_share: 0.9,
    });
    const c = seg({ along_start_m: 10_000, along_end_m: 11_400 }); // end 400 m later
    const r = curateSegments([a, b, c]);
    expect(selected(r).sort()).toEqual([b.id, c.id].sort());
    expect(r.rows.find((x) => x.id === a.id)?.duplicate_of).toBe(b.id);
  });

  it("breaks duplicate ties by Strava athlete count, then id", () => {
    const a = seg({ athlete_count: 10 });
    const b = seg({ athlete_count: 20 });
    expect(selected(curateSegments([a, b]))).toEqual([b.id]);
    const c = seg();
    const d = seg();
    expect(selected(curateSegments([d, c]))).toEqual([c.id]);
  });

  it("drops rarely ridden segments unless an admin curated them", () => {
    const rare = seg({ ride_share: 0.2 });
    const curated = seg({
      ride_share: 0.2,
      curated_rank: 3,
      along_start_m: 20_000,
      along_end_m: 21_000,
    });
    expect(selected(curateSegments([rare, curated]))).toEqual([curated.id]);
  });

  it("keeps each direction separately", () => {
    const s = seg();
    const n = seg({ direction: "north" });
    expect(selected(curateSegments([s, n])).sort()).toEqual(
      [s.id, n.id].sort(),
    );
  });

  it("caps at 40 per direction, keeping at least 8 climbs and 8 flats", () => {
    const climbs = Array.from({ length: 45 }, (_, i) =>
      seg({
        along_start_m: i * 1000,
        along_end_m: i * 1000 + 900,
        ride_share: 0.99,
      }),
    );
    const flats = Array.from({ length: 10 }, (_, i) =>
      seg({
        terrain: "flat",
        average_grade: 0.5,
        along_start_m: 100_000 + i * 1000,
        along_end_m: 100_000 + i * 1000 + 900,
        ride_share: 0.6,
      }),
    );
    const r = curateSegments([...climbs, ...flats]);
    const ids = new Set(selected(r));
    expect(ids.size).toBe(40);
    expect(flats.filter((f) => ids.has(f.id))).toHaveLength(8);
  });

  it("is deterministic", () => {
    const input = Array.from({ length: 12 }, (_, i) =>
      seg({
        along_start_m: i * 50,
        along_end_m: i * 50 + 800,
        ride_share: 0.5 + i / 100,
      }),
    );
    expect(curateSegments(input)).toEqual(curateSegments([...input].reverse()));
  });
});
