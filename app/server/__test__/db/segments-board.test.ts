/**
 * Phase 07b: get_segment_leaderboard (migration 045) against the fixture
 * segments and efforts from scripts/gen-fixtures.ts (EXPECTED.segments).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { freezeFixtureClock, RIDER } from "../../../test/characterize";
import { trackSubrequests } from "../../../lib/perf";
import {
  fetchSegmentLeaderboardImpl,
  setSegmentBoardOptInImpl,
  type SegmentLeaderboard,
} from "../../segments";

const service = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);

interface Leader {
  userId: string;
  seconds: number;
}
const EXPECTED = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../supabase/seed/EXPECTED.json"),
    "utf8",
  ),
).segments as {
  shown: number[];
  leaders: Record<string, Leader>;
  riderCounts: Record<string, number>;
  pctOfKom: Record<string, number>;
  crown: { userId: string; koms: number; podiums: number; points: number }[];
  optedOutRider: string;
  north: number[];
  both: number[];
  window: {
    date_from: string;
    date_to: string;
    leaders: Record<string, Leader>;
  };
};

async function board(q: Record<string, unknown> = {}) {
  const { data, error } = await anon.rpc("get_segment_leaderboard", { q });
  if (error) throw new Error(`get_segment_leaderboard: ${error.message}`);
  return data as SegmentLeaderboard;
}

freezeFixtureClock();

const ids = (b: SegmentLeaderboard) => b.segments.map((s) => s.id);

describe("get_segment_leaderboard — default filters", () => {
  let b: SegmentLeaderboard;
  beforeAll(async () => {
    b = await board();
  });

  it("shows the expected segments in display order", () => {
    expect(b.corridor).toBe("skyline");
    expect(ids(b)).toEqual(EXPECTED.shown);
    expect(b.segments_total).toBe(EXPECTED.shown.length);
  });

  it("each segment's leader and rider count match the fixture", () => {
    for (const s of b.segments) {
      const want = EXPECTED.leaders[String(s.id)];
      expect(s.riders[0]).toMatchObject({
        user_id: want.userId,
        best_seconds: want.seconds,
        rank: 1,
      });
      expect(s.rider_count).toBe(EXPECTED.riderCounts[String(s.id)]);
    }
  });

  it("omits too-small, descent, off-corridor and north segments", () => {
    for (const id of [900004, 900006, 900007, 900008])
      expect(ids(b)).not.toContain(id);
  });

  it("never returns the opted-out rider, though they are fastest on 900001", async () => {
    const { data } = await service
      .from("segment_efforts")
      .select("user_id, elapsed_time_seconds")
      .eq("segment_id", 900001)
      .order("elapsed_time_seconds")
      .limit(1)
      .single();
    expect(data!.user_id).toBe(EXPECTED.optedOutRider);
    expect(JSON.stringify(b)).not.toContain(EXPECTED.optedOutRider);
  });

  it("returns only user_id, display_name and avatar_url from users", () => {
    const rider = b.segments[0].riders[0];
    expect(Object.keys(rider).sort()).toEqual(
      [
        "avatar_url",
        "best_date",
        "best_seconds",
        "display_name",
        "effort_count",
        "kom_rank",
        "pct_of_kom",
        "rank",
        "strava_activity_id",
        "user_id",
      ].sort(),
    );
    expect(Object.keys(b.crown[0]).sort()).toEqual(
      [
        "avatar_url",
        "display_name",
        "mean_pct_of_kom",
        "points",
        "podiums",
        "rank",
        "segments_ridden",
        "segments_total",
        "sf2g_koms",
        "strava_top10s",
        "user_id",
      ].sort(),
    );
  });

  it("crown order and numbers match the fixture", () => {
    expect(
      b.crown.map((c) => ({
        userId: c.user_id,
        koms: c.sf2g_koms,
        podiums: c.podiums,
        points: c.points,
      })),
    ).toEqual(EXPECTED.crown);
    expect(b.crown.map((c) => c.rank)).toEqual(
      EXPECTED.crown.map((_, i) => i + 1),
    );
    for (const c of b.crown) expect(c.segments_total).toBe(b.segments_total);
  });

  it("pct_of_kom is round(kom / best, 3)", async () => {
    const { data: segs } = await service
      .from("segments")
      .select("id, kom_seconds, overall_seconds")
      .in("id", [900001, 900002, 900003]);
    for (const s of b.segments.filter((x) => x.id <= 900003)) {
      const seg = segs!.find((x) => x.id === s.id)!;
      const kom = seg.overall_seconds ?? seg.kom_seconds;
      const leader = s.riders[0];
      expect(leader.pct_of_kom).toBe(
        Math.round((kom / leader.best_seconds) * 1000) / 1000,
      );
      expect(leader.pct_of_kom).toBe(EXPECTED.pctOfKom[String(s.id)]);
    }
    expect(
      b.segments.find((s) => s.id === 900005)!.riders[0].pct_of_kom,
    ).toBeNull();
  });
});

describe("get_segment_leaderboard — filters", () => {
  it("direction north and both", async () => {
    expect(ids(await board({ direction: "north" }))).toEqual(EXPECTED.north);
    expect(ids(await board({ direction: "both" }))).toEqual(EXPECTED.both);
  });

  it("terrain climb returns only climbs", async () => {
    expect(ids(await board({ terrain: "climb" }))).toEqual([
      900001, 900002, 900003,
    ]);
    expect(ids(await board({ terrain: "climb", direction: "both" }))).toEqual([
      900001, 900002, 900003, 900007,
    ]);
    expect(ids(await board({ terrain: "flat" }))).toEqual([900005]);
  });

  it("a date window changes the 900003 leader as the fixture plans", async () => {
    const b = await board({
      date_from: EXPECTED.window.date_from,
      date_to: EXPECTED.window.date_to,
    });
    for (const [id, want] of Object.entries(EXPECTED.window.leaders)) {
      const s = b.segments.find((x) => x.id === Number(id))!;
      expect(s.riders[0]).toMatchObject({
        user_id: want.userId,
        best_seconds: want.seconds,
      });
    }
    expect(EXPECTED.window.leaders["900003"].userId).not.toBe(
      EXPECTED.leaders["900003"].userId,
    );
  });

  it("top limits the riders per segment, not rider_count", async () => {
    const b = await board({ top: 2 });
    for (const s of b.segments) {
      expect(s.riders.length).toBeLessThanOrEqual(2);
      expect(s.rider_count).toBe(EXPECTED.riderCounts[String(s.id)]);
    }
  });
});

describe("private rides", () => {
  const ACTIVITY_ID = 1_820_000_001;
  const EFFORT_ID = 8_200_000_001;
  let rideId = "";

  beforeAll(async () => {
    const { data, error } = await service
      .from("rides")
      .insert({
        user_id: RIDER.dee,
        strava_activity_id: ACTIVITY_ID,
        name: "Private Skyline test",
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
    const { error: e2 } = await service.from("segment_efforts").insert({
      id: EFFORT_ID,
      segment_id: 900002,
      user_id: RIDER.dee,
      ride_id: rideId,
      elapsed_time_seconds: EXPECTED.leaders["900002"].seconds - 60,
      start_date: "2026-10-14T14:20:00Z",
    });
    if (e2) throw new Error(`insert effort: ${e2.message}`);
  });

  afterAll(async () => {
    await service.from("segment_efforts").delete().eq("id", EFFORT_ID);
    await service.from("rides").delete().eq("id", rideId);
  });

  it("an effort from a private ride never ranks", async () => {
    const s = (await board()).segments.find((x) => x.id === 900002)!;
    expect(s.riders[0].user_id).toBe(EXPECTED.leaders["900002"].userId);
    expect(s.riders[0].best_seconds).toBe(EXPECTED.leaders["900002"].seconds);
    expect(JSON.stringify(s)).not.toContain(String(ACTIVITY_ID));
  });
});

describe("access", () => {
  it("anon can call the RPC but cannot read segment_efforts", async () => {
    const { error: rpcError } = await anon.rpc("get_segment_leaderboard", {
      q: {},
    });
    expect(rpcError).toBeNull();
    const { data, error } = await anon.from("segment_efforts").select("*");
    expect(error?.message ?? "").toMatch(/permission denied/);
    expect(data).toBeNull();
  });
});

describe("server functions", () => {
  it("fetchSegmentLeaderboardImpl makes exactly one request", async () => {
    const { result, subrequests } = await trackSubrequests(() =>
      fetchSegmentLeaderboardImpl({}),
    );
    expect(subrequests).toBe(1);
    expect(result.segments.map((s) => s.id)).toEqual(EXPECTED.shown);
  });

  it("fetchSegmentLeaderboardImpl resolves the range preset in LA time", async () => {
    // FIXTURE_NOW is 2026-10-16 (frozen above).
    const thisYear = await fetchSegmentLeaderboardImpl({ range: "this-year" });
    expect(thisYear).toEqual(
      await board({ date_from: "2026-01-01", date_to: "2026-10-16" }),
    );
  });

  it("opting in makes a rider appear; opting out removes them", async () => {
    const rider = EXPECTED.optedOutRider;
    try {
      expect(await setSegmentBoardOptInImpl(rider, true)).toEqual({
        optIn: true,
      });
      const s = (await board()).segments.find((x) => x.id === 900001)!;
      expect(s.riders[0].user_id).toBe(rider);
    } finally {
      expect(await setSegmentBoardOptInImpl(rider, false)).toEqual({
        optIn: false,
      });
    }
    expect(JSON.stringify(await board())).not.toContain(rider);
  });
});
