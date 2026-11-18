import { describe, expect, it } from "vitest";
import {
  buildMatrix,
  crown,
  cumulative,
  segmentStats,
  honours,
  overlapMeters,
  requiredSegments,
  resolveChain,
  segmentBoard,
  selectSegments,
  versusAbove,
  type MatrixSegment,
  type RawCell,
  type SegmentMatrixResponse,
} from "../segment-cumulative";

function seg(
  id: number,
  a: number,
  b: number,
  over: Partial<MatrixSegment> = {},
): MatrixSegment {
  return {
    id,
    name: `S${id}`,
    distance_meters: Math.abs(b - a),
    average_grade: 3,
    terrain: "climb",
    along_start_m: a,
    along_end_m: b,
    start_latlng: [37.6, -122.4],
    end_latlng: [37.5, -122.3],
    kom_seconds: null,
    qom_seconds: null,
    overall_seconds: null,
    xoms_fetched_at: null,
    athlete_count: 100,
    ride_share: 0.9,
    curated_rank: null,
    ...over,
  };
}

const riders = ["ada", "bo", "cy", "di", "ed"].map((n) => ({
  user_id: n,
  display_name: n.toUpperCase(),
  avatar_url: null,
}));

/** times[segIdx][riderIdx] = seconds | null */
function matrixOf(
  segments: MatrixSegment[],
  times: (number | null)[][],
  komRank: Record<string, number> = {},
) {
  const cells: RawCell[] = [];
  times.forEach((row, si) =>
    row.forEach((t, ri) => {
      if (t !== null)
        cells.push([
          si,
          ri,
          t,
          "2026-05-01",
          1000 + si * 10 + ri,
          2,
          "2026-01-01",
          komRank[`${si}|${ri}`] ?? null,
        ]);
    }),
  );
  const res: SegmentMatrixResponse = {
    corridor: "skyline",
    direction: "south",
    year: null,
    years: [2026],
    segments,
    riders: riders.slice(0, times[0]?.length ?? 0),
    cells,
  };
  return buildMatrix(res);
}

describe("resolveChain", () => {
  it("never returns overlapping segments and prefers more coverage", () => {
    const segs = [
      seg(1, 0, 1000),
      seg(2, 500, 3000), // overlaps 1 and 3
      seg(3, 1000, 2000),
      seg(4, 2000, 3000),
      seg(5, 5000, 9000),
    ];
    const chain = resolveChain(segs);
    expect(overlapMeters(chain)).toBe(0);
    expect(chain.map((s) => s.id)).toEqual([1, 3, 4, 5]);
  });

  it("tolerates 20 m of overlap between neighbours", () => {
    const chain = resolveChain([seg(1, 0, 1015), seg(2, 1000, 2000)]);
    expect(chain.map((s) => s.id)).toEqual([1, 2]);
  });

  it("is deterministic regardless of input order", () => {
    const segs = Array.from({ length: 15 }, (_, i) =>
      seg(i + 1, i * 300, i * 300 + 700, { ride_share: (i % 4) / 4 }),
    );
    expect(resolveChain(segs).map((s) => s.id)).toEqual(
      resolveChain([...segs].reverse()).map((s) => s.id),
    );
    expect(overlapMeters(resolveChain(segs))).toBe(0);
  });
});

describe("overlapMeters", () => {
  it("counts metres covered twice", () => {
    expect(overlapMeters([seg(1, 0, 1000), seg(2, 600, 1500)])).toBe(400);
    expect(overlapMeters([seg(1, 0, 1000), seg(2, 1000, 1500)])).toBe(0);
    // Northbound spans are normalised.
    expect(overlapMeters([seg(1, 1000, 0), seg(2, 600, 1500)])).toBe(400);
  });
});

describe("selectSegments", () => {
  const segs = [
    seg(1, 0, 1000),
    seg(2, 1000, 4000, { terrain: "flat", average_grade: 0.5 }),
    seg(3, 4000, 4500),
    seg(4, 0, 4500, { terrain: "flat", average_grade: 0.2 }),
  ];

  it("climbs and flats filter by terrain, then resolve a chain", () => {
    expect(
      selectSegments(segs, { set: "climbs", minKm: null, maxKm: null }).map(
        (s) => s.id,
      ),
    ).toEqual([1, 3]);
    expect(
      selectSegments(segs, { set: "flats", minKm: null, maxKm: null }).map(
        (s) => s.id,
      ),
    ).toEqual([4]);
  });

  it("the length range applies to every preset", () => {
    expect(
      selectSegments(segs, { set: "core", minKm: 0.9, maxKm: 3.5 }).map(
        (s) => s.id,
      ),
    ).toEqual([1, 2]);
  });

  it("overlap keeps every matching segment", () => {
    expect(
      selectSegments(segs, {
        set: "core",
        minKm: null,
        maxKm: null,
        overlap: true,
      }).map((s) => s.id),
    ).toEqual([1, 4, 2, 3]);
  });

  it("custom returns exactly the given ids, in route order", () => {
    expect(
      selectSegments(segs, {
        set: "custom",
        minKm: null,
        maxKm: null,
        ids: [3, 1],
      }).map((s) => s.id),
    ).toEqual([1, 3]);
  });
});

describe("honours", () => {
  const s = seg(1, 0, 1000, { kom_seconds: 200, overall_seconds: 200 });
  it("Strava KOM at exactly the KOM time", () => {
    expect(honours({ seconds: 200, kom_rank: 1 }, s, 200)).toEqual({
      stravaKom: true,
      formerKom: false,
      sf2gRecord: true,
    });
  });
  it("former KOM one second slower with kom_rank 1", () => {
    expect(honours({ seconds: 201, kom_rank: 1 }, s, 201)).toEqual({
      stravaKom: false,
      formerKom: true,
      sf2gRecord: true,
    });
  });
  it("no Strava honour when the KOM is unknown", () => {
    expect(
      honours({ seconds: 150, kom_rank: null }, seg(2, 0, 1), 140),
    ).toEqual({
      stravaKom: false,
      formerKom: false,
      sf2gRecord: false,
    });
  });
});

describe("segmentBoard", () => {
  it("ranks with ties sharing a rank, gaps from the leader", () => {
    const m = matrixOf(
      [seg(1, 0, 1000, { kom_seconds: 90 })],
      [[100, 100, 110]],
    );
    const b = segmentBoard(m, 1);
    expect(b.map((r) => [r.rider.user_id, r.rank, r.gap_seconds])).toEqual([
      ["ada", 1, 0],
      ["bo", 1, 0],
      ["cy", 3, 10],
    ]);
    expect(b[0].pct_of_kom).toBe(0.9);
    expect(b[0].honours.sf2gRecord).toBe(true);
  });
});

describe("cumulative", () => {
  const segs = Array.from({ length: 10 }, (_, i) =>
    seg(i + 1, i * 1000, i * 1000 + 900),
  );
  // ada: all 10; bo: 8 of 10; cy: 7 of 10; di: all but slow.
  const times = segs.map((_, i) => [
    100,
    i < 8 ? 95 : null,
    i < 7 ? 90 : null,
    120,
  ]);
  const m = matrixOf(segs, times);
  const r = cumulative(
    m,
    segs.map((s) => s.id),
  );

  it("ranks riders with ≥ 80 % of the segments and fills the gaps", () => {
    expect(r.required).toBe(8);
    expect(r.ranked.map((x) => [x.rider.user_id, x.done])).toEqual([
      ["ada", 10],
      ["bo", 8],
      ["di", 10],
    ]);
    // bo's two missing segments count as the slowest time (120) + 10 %.
    const bo = r.ranked.find((x) => x.rider.user_id === "bo")!;
    expect(bo.total_seconds).toBe(8 * 95 + 2 * 132);
    expect(bo.splits.filter((s) => s.filled)).toHaveLength(2);
    expect(bo.splits[9]).toMatchObject({
      filled: true,
      seconds: 132,
      rank: null,
    });
  });

  it("riders under 80 % are listed, unranked", () => {
    expect(r.partial.map((x) => [x.rider.user_id, x.done, x.of])).toEqual([
      ["cy", 7, 10],
    ]);
  });

  it("skipping a segment never beats riding it slowly", () => {
    const di = r.ranked.find((x) => x.rider.user_id === "di")!;
    const bo = r.ranked.find((x) => x.rider.user_id === "bo")!;
    expect(bo.splits[9].seconds).toBeGreaterThan(di.splits[9].seconds);
  });

  it("gaps, dream ride and distance", () => {
    expect(r.ranked[0].gap_seconds).toBe(0);
    expect(r.ranked[1].gap_seconds).toBe(
      r.ranked[1].total_seconds - r.ranked[0].total_seconds,
    );
    // Fastest per segment: cy (90) on 0–6, bo (95) on 7, ada (100) on 8–9.
    expect(r.dream.total_seconds).toBe(7 * 90 + 95 + 2 * 100);
    expect(r.dream.holders.map((h) => [h.rider.user_id, h.segments])).toEqual([
      ["cy", 7],
      ["ada", 2],
      ["bo", 1],
    ]);
    expect(r.distance_m).toBe(9000);
    expect(r.kom_total_seconds).toBeNull();
  });

  it("ties share a rank", () => {
    const t = cumulative(matrixOf([seg(1, 0, 1000)], [[100, 100]]), [1]);
    expect(t.ranked.map((x) => x.rank)).toEqual([1, 1]);
  });

  it("counts Strava KOMs and SF2G records per rider", () => {
    const k = matrixOf(
      [
        seg(1, 0, 1000, { kom_seconds: 100 }),
        seg(2, 1000, 2000, { kom_seconds: 50 }),
      ],
      [
        [100, 105],
        [80, 70],
      ],
    );
    const res = cumulative(k, [1, 2]);
    const ada = res.ranked.find((x) => x.rider.user_id === "ada")!;
    const bo = res.ranked.find((x) => x.rider.user_id === "bo")!;
    expect([ada.strava_koms, ada.sf2g_records]).toEqual([1, 1]);
    expect([bo.strava_koms, bo.sf2g_records]).toEqual([0, 1]);
    expect(res.kom_total_seconds).toBe(150);
  });

  it("ignores selected segments nobody has ridden", () => {
    const k = matrixOf([seg(1, 0, 1000), seg(2, 1000, 2000)], [[100], [null]]);
    const res = cumulative(k, [1, 2]);
    expect(res.segments.map((s) => s.id)).toEqual([1]);
    expect(res.ranked).toHaveLength(1);
  });

  it("versusAbove finds the biggest loss and gain against the rider above", () => {
    const k = matrixOf(
      [seg(1, 0, 1000), seg(2, 1000, 2000), seg(3, 2000, 3000)],
      [
        [100, 90],
        [100, 130],
        [100, 95],
      ],
    );
    const res = cumulative(k, [1, 2, 3]);
    expect(res.ranked[1].rider.user_id).toBe("bo");
    expect(versusAbove(res, "bo")).toEqual({
      lose: { segment_id: 2, seconds: 30 },
      gain: { segment_id: 1, seconds: 10 },
    });
  });

  it("requiredSegments rounds 80 % up", () => {
    expect([1, 2, 3, 4, 5, 10, 11].map(requiredSegments)).toEqual([
      1, 2, 3, 4, 4, 8, 9,
    ]);
  });
});

describe("crown and segmentStats", () => {
  const segs = [
    seg(1, 0, 1000, { kom_seconds: 100 }),
    seg(2, 1000, 2000),
    seg(3, 2000, 3000),
  ];
  const m = matrixOf(segs, [
    [100, 110, 120],
    [90, 80, null],
    [70, 75, 60],
  ]);

  it("ranks by Strava KOMs, then SF2G records, then points", () => {
    const c = crown(m, [1, 2, 3]);
    expect(
      c.map((r) => [r.rider.user_id, r.strava_koms, r.sf2g_records, r.points]),
    ).toEqual([
      ["ada", 1, 1, 10 + 9 + 9],
      ["bo", 0, 1, 9 + 10 + 8],
      ["cy", 0, 1, 8 + 10],
    ]);
    expect(c.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("segment stats: riders, attempts, median, gap, KOM holder", () => {
    const s = segmentStats(m, 1);
    expect(s).toMatchObject({
      riders: 3,
      attempts: 6,
      median_seconds: 110,
      first_gap_seconds: 10,
    });
    expect(s.kom_holder?.user_id).toBe("ada");
    expect(segmentStats(m, 2).median_seconds).toBe(85);
  });
});
