/**
 * Phase 09c: get_segment_matrix (migration 052) and the cumulative maths on
 * top of it, against the fixture (EXPECTED.segments.cumulative, computed
 * with plain loops in scripts/gen-fixtures.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { RIDER } from "../../../test/characterize";
import { trackSubrequests } from "../../../lib/perf";
import {
  buildMatrix,
  cumulative,
  segmentBoard,
  selectSegments,
  type SegmentMatrixResponse,
} from "../../../lib/segment-cumulative";
import { fetchSegmentMatrixImpl } from "../../segments";

const service = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);

const EXPECTED = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../supabase/seed/EXPECTED.json"),
    "utf8",
  ),
).segments as {
  leaders: Record<string, { userId: string; seconds: number }>;
  optedOutRider: string;
  window: { leaders: Record<string, { userId: string; seconds: number }> };
  cumulative: {
    ids: number[];
    required: number;
    ranked: { userId: string; done: number; total: number }[];
    partial: { userId: string; done: number; total: number }[];
  };
};

async function matrix(q: Record<string, unknown> = {}) {
  const { data, error } = await anon.rpc("get_segment_matrix", { q });
  if (error) throw new Error(`get_segment_matrix: ${error.message}`);
  return data as unknown as SegmentMatrixResponse;
}

describe("get_segment_matrix", () => {
  let res: SegmentMatrixResponse;
  beforeAll(async () => {
    res = await matrix();
  });

  it("returns the southbound selectable segments in route order", () => {
    expect(res.segments.map((s) => s.id)).toEqual(EXPECTED.cumulative.ids);
    const along = res.segments.map((s) => s.along_start_m!);
    expect([...along].sort((a, b) => a - b)).toEqual(along);
    expect(res.direction).toBe("south");
    expect(res.years).toEqual([2026, 2025]);
  });

  it("north returns only the northbound segment", async () => {
    expect(
      (await matrix({ direction: "north" })).segments.map((s) => s.id),
    ).toEqual([900007]);
  });

  it("never includes a hidden rider, though they are fastest on 900001", () => {
    expect(JSON.stringify(res)).not.toContain(EXPECTED.optedOutRider);
  });

  it("returns only user_id, display_name and avatar_url from users", () => {
    for (const r of res.riders)
      expect(Object.keys(r).sort()).toEqual([
        "avatar_url",
        "display_name",
        "user_id",
      ]);
  });

  it("each segment's fastest cell is the fixture leader", () => {
    const m = buildMatrix(res);
    // EXPECTED.leaders covers the segments the old board shows (≥ 3 riders).
    for (const id of EXPECTED.cumulative.ids.filter(
      (x) => String(x) in EXPECTED.leaders,
    )) {
      const b = segmentBoard(m, id);
      expect([id, b[0].rider.user_id, b[0].cell.seconds]).toEqual([
        id,
        EXPECTED.leaders[String(id)].userId,
        EXPECTED.leaders[String(id)].seconds,
      ]);
    }
  });

  it("a year keeps only that year's bests (the 900003 leader changes in 2025)", async () => {
    const m = buildMatrix(await matrix({ year: 2025 }));
    const b = segmentBoard(m, 900003);
    expect(b[0].rider.user_id).toBe(EXPECTED.window.leaders["900003"].userId);
    expect(b[0].cell.seconds).toBe(EXPECTED.window.leaders["900003"].seconds);
  });
});

describe("cumulative on the fixture", () => {
  it("matches the plain-loop totals, ranks and partial list", async () => {
    const m = buildMatrix(await matrix());
    const ids = selectSegments(m.segments, {
      set: "core",
      minKm: null,
      maxKm: null,
    }).map((s) => s.id);
    expect(ids).toEqual(EXPECTED.cumulative.ids);
    const r = cumulative(m, ids);
    expect(r.required).toBe(EXPECTED.cumulative.required);
    expect(
      r.ranked.map((x) => ({
        userId: x.rider.user_id,
        done: x.done,
        total: x.total_seconds,
      })),
    ).toEqual(EXPECTED.cumulative.ranked);
    expect(
      r.partial.map((x) => ({
        userId: x.rider.user_id,
        done: x.done,
        total: x.total_seconds,
      })),
    ).toEqual(EXPECTED.cumulative.partial);
  });
});

describe("hidden and private rides", () => {
  const ACTIVITY_ID = 1_830_000_001;
  let rideId = "";
  beforeAll(async () => {
    const { data, error } = await service
      .from("rides")
      .insert({
        user_id: RIDER.dee,
        strava_activity_id: ACTIVITY_ID,
        name: "Private Skyline matrix test",
        ride_date: "2026-10-14",
        start_date: "2026-10-14T14:00:00Z",
        route_category: "skyline",
        is_private: true,
        segment_efforts_fetched_at: "2026-10-14T15:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert ride: ${error.message}`);
    rideId = data.id;
    const { error: e2 } = await service.from("segment_bests").insert({
      segment_id: 900002,
      user_id: RIDER.dee,
      year: 2027,
      effort_id: 8_300_000_001,
      ride_id: rideId,
      ride_date: "2026-10-14",
      elapsed_time_seconds: 1,
      effort_count: 1,
      first_ride_date: "2026-10-14",
    });
    if (e2) throw new Error(`insert best: ${e2.message}`);
  });
  afterAll(async () => {
    await service.from("segment_bests").delete().eq("ride_id", rideId);
    await service.from("rides").delete().eq("id", rideId);
  });

  it("a best on a private ride never appears", async () => {
    const res = await matrix();
    expect(JSON.stringify(res)).not.toContain(String(ACTIVITY_ID));
    expect(res.years).not.toContain(2027);
  });
});

describe("access and cost", () => {
  it("anon can call the RPC", async () => {
    const { error } = await anon.rpc("get_segment_matrix", { q: {} });
    expect(error).toBeNull();
  });

  it("fetchSegmentMatrixImpl makes exactly one request", async () => {
    const { result, subrequests } = await trackSubrequests(() =>
      fetchSegmentMatrixImpl({}),
    );
    expect(subrequests).toBe(1);
    expect(result.segments.map((s) => s.id)).toEqual(EXPECTED.cumulative.ids);
  });
});

describe("performance", () => {
  // 60 riders × 40 northbound segments × 5 years = 12 k bests: one route and
  // direction at full backfill (all three routes ≈ 100 k rows, but the RPC
  // only reads one route's selectable segments). Northbound, so the
  // fixture's southbound board is untouched; removed afterwards. Inserts are
  // slow through supabase-js under vitest (~1 s per 1,000 rows), hence the
  // size; outside vitest the RPC answered in ~200 ms on all 100 k rows.
  const SEG0 = 700_000;
  const USERS = Array.from(
    { length: 60 },
    (_, i) => `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
  );
  const rideOf = new Map<string, string>();

  beforeAll(async () => {
    const { error: uErr } = await service.from("users").insert(
      USERS.map((id, i) => ({
        id,
        strava_id: 8_800_000 + i,
        username: `load-${i}`,
        first_name: "Load",
        last_name: String(i),
        strava_access_token: "",
        strava_refresh_token: "",
        strava_token_expires_at: "2026-01-01T00:00:00Z",
      })),
    );
    if (uErr) throw new Error(`users: ${uErr.message}`);
    const { data: rides, error: rErr } = await service
      .from("rides")
      .insert(
        USERS.map((id, i) => ({
          user_id: id,
          strava_activity_id: 1_840_000_000 + i,
          name: "load",
          ride_date: "2026-05-01",
          start_date: "2026-05-01T14:00:00Z",
          route_category: "skyline",
          segment_efforts_fetched_at: "2026-05-01T15:00:00Z",
        })),
      )
      .select("id, user_id");
    if (rErr) throw new Error(`rides: ${rErr.message}`);
    for (const r of rides!) rideOf.set(r.user_id, r.id);
    const { error: sErr } = await service.from("segments").insert(
      Array.from({ length: 40 }, (_, i) => ({
        id: SEG0 + i,
        name: `Load ${i}`,
        distance_meters: 1000,
        average_grade: 3,
        start_latlng: [37.6, -122.4],
        end_latlng: [37.61, -122.41],
        corridor: "skyline",
        direction: "north",
        along_start_m: 50_000 - i * 1000,
        along_end_m: 49_000 - i * 1000,
        in_core: true,
        selectable: true,
      })),
    );
    if (sErr) throw new Error(`segments: ${sErr.message}`);
    const rows = [];
    for (const u of USERS)
      for (let s = 0; s < 40; s++)
        for (let y = 0; y < 5; y++)
          rows.push({
            segment_id: SEG0 + s,
            user_id: u,
            year: 2022 + y,
            effort_id: 1,
            ride_id: rideOf.get(u)!,
            ride_date: "2026-05-01",
            elapsed_time_seconds: 200 + ((s * 7 + y * 13 + rows.length) % 97),
            effort_count: 1,
            first_ride_date: "2026-05-01",
          });
    for (let i = 0; i < rows.length; i += 2_000) {
      const { error } = await service
        .from("segment_bests")
        .insert(rows.slice(i, i + 2_000));
      if (error) throw new Error(`bests: ${error.message}`);
    }
  }, 120_000);

  afterAll(async () => {
    await service
      .from("segments")
      .delete()
      .gte("id", SEG0)
      .lt("id", SEG0 + 40);
    await service.from("rides").delete().in("user_id", USERS);
    await service.from("users").delete().in("id", USERS);
  }, 120_000);

  // 1 s, not 500 ms: a cold local stack in CI is slower than production.
  it("all time and one year each answer in under a second", async () => {
    for (const q of [
      { direction: "north" },
      { direction: "north", year: 2024 },
    ]) {
      await matrix(q); // warm
      const t0 = performance.now();
      const res = await matrix(q);
      const ms = performance.now() - t0;
      expect(res.segments).toHaveLength(41); // 40 + fixture 900007
      expect(res.riders.length).toBeGreaterThanOrEqual(60);
      expect(ms).toBeLessThan(1000);
    }
  });
});
