/**
 * Phase 07a/09a: Skyline rides → segment_efforts jobs → segments and the
 * rider's yearly PRs (segment_bests), against the local fixture database
 * with the Strava API mocked.
 */
import { createClient } from "@supabase/supabase-js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { mockStrava, type MockActivity } from "../../../test/strava-mock";
import { RIDER } from "../../../test/characterize";
import { decodePolyline } from "../../../lib/polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../../../lib/constants";
import type {
  StravaSegmentEffort,
  StravaSegmentSummary,
} from "../../../lib/strava";
import { segmentEffortsStep, segmentXomsStep } from "../../segments-ingest";
import {
  classifySegmentCorridor,
  segmentDirection,
} from "../../../lib/segment-corridor";
import { drainSyncJobs, defaultDrainDeps, runJob } from "../../sync-drain";
import { trackSubrequests } from "../../../lib/perf";
import {
  curateSelectableSegmentsImpl,
  enqueueSegmentBackfillImpl,
  fetchSegmentIngestStatsImpl,
} from "../../segments-admin";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
/** A throwaway rider (a copy of Ada's account); fixture riders stay untouched. */
const TEST_USER = "00000000-0000-4000-8000-0000000000fe";
const TEST_STRAVA_ID = 7_999_998;
const ACTIVITY_BASE = 1_810_000_000;
/** Test segments and efforts live in their own id ranges. */
const SEGMENT_BASE = 800_000;
const EFFORT_BASE = 8_100_000_000;

process.env.STRAVA_CLIENT_ID = "test-client";
process.env.STRAVA_CLIENT_SECRET = "test-secret";

const line = decodePolyline(SKYLINE_REFERENCE_POLYLINE);
const east = ([lat, lng]: [number, number], m: number): [number, number] => [
  lat,
  lng + m / (111_320 * Math.cos((lat * Math.PI) / 180)),
];

let polyline = "";

async function insertRide(
  n: number,
  over: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await db
    .from("rides")
    .insert({
      user_id: TEST_USER,
      strava_activity_id: ACTIVITY_BASE + n,
      name: `Skyline test ${n}`,
      ride_date: "2026-10-14",
      start_date: "2026-10-14T14:00:00Z",
      route_category: "skyline",
      summary_polyline: polyline,
      ...over,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert ride: ${error.message}`);
  return data.id;
}

async function jobs(kind?: string) {
  let q = db.from("sync_jobs").select("*").order("id");
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  return data ?? [];
}

async function bests(rideOrUser: { ride?: string; user?: string }) {
  let q = db
    .from("segment_bests")
    .select("*")
    .order("segment_id")
    .order("year");
  if (rideOrUser.ride) q = q.eq("ride_id", rideOrUser.ride);
  if (rideOrUser.user) q = q.eq("user_id", rideOrUser.user);
  const { data, error } = await q;
  if (error) throw new Error(`bests: ${error.message}`);
  return data ?? [];
}

async function count(
  table: "segments",
  column: string,
  from: number,
  to: number,
): Promise<number> {
  const { count: n } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(column, from)
    .lt(column, to);
  return n ?? 0;
}

function summary(
  i: number,
  start: [number, number],
  end: [number, number],
  over: Partial<StravaSegmentSummary> = {},
): StravaSegmentSummary {
  return {
    id: SEGMENT_BASE + i,
    name: `Test segment ${i}`,
    activity_type: "Ride",
    distance: 1500,
    average_grade: 4.2,
    maximum_grade: 9,
    elevation_high: 250,
    elevation_low: 190,
    climb_category: 0,
    start_latlng: start,
    end_latlng: end,
    private: false,
    hazardous: false,
    ...over,
  };
}

function effort(i: number, segment: StravaSegmentSummary): StravaSegmentEffort {
  return {
    id: EFFORT_BASE + i,
    elapsed_time: 300 + i,
    moving_time: 295 + i,
    start_date: "2026-10-14T14:20:00Z",
    start_date_local: "2026-10-14T07:20:00Z",
    distance: segment.distance,
    kom_rank: i === 1 ? 7 : null,
    pr_rank: 1,
    average_watts: 250,
    device_watts: true,
    segment,
  };
}

/** 3 corridor segments sampled from the reference line, 1 off it, 1 a Run segment. */
function detailActivity(activityId: number): MockActivity {
  const segs = [
    summary(1, line[10], line[30]),
    summary(2, line[40], line[60], { average_grade: 0.5 }),
    summary(3, line[90], line[70]), // northbound
    summary(4, east(line[10], 2000), east(line[30], 2000)),
    summary(5, line[10], line[30], { activity_type: "Run" }),
  ];
  return {
    id: activityId,
    name: "Skyline",
    type: "Ride",
    start_date: "2026-10-14T14:00:00Z",
    start_date_local: "2026-10-14T07:00:00Z",
    timezone: "(GMT-08:00) America/Los_Angeles",
    distance: 48_000,
    moving_time: 7_200,
    elapsed_time: 8_000,
    total_elevation_gain: 600,
    average_speed: 6.6,
    max_speed: 14,
    start_latlng: line[0],
    end_latlng: line[line.length - 1],
    map: { summary_polyline: polyline },
    segment_efforts: segs.map((s, i) => effort(i + 1, s)),
  };
}

async function cleanup() {
  await db.from("sync_jobs").delete().gte("id", 0);
  await db
    .from("rides")
    .delete()
    .gte("strava_activity_id", ACTIVITY_BASE)
    .lt("strava_activity_id", ACTIVITY_BASE + 10_000);
  await db
    .from("segments")
    .delete()
    .gte("id", SEGMENT_BASE)
    .lt("id", SEGMENT_BASE + 100_000);
  await db
    .from("users")
    .update({ strava_token_expires_at: "2026-10-16T18:00:00Z" })
    .eq("id", TEST_USER);
}

beforeAll(async () => {
  const { data: ada } = await db
    .from("users")
    .select("*")
    .eq("id", RIDER.ada)
    .single();
  const { display_name: _generated, ...row } = ada!;
  const { error } = await db.from("users").insert({
    ...row,
    id: TEST_USER,
    strava_id: TEST_STRAVA_ID,
    username: "segments-test",
    segment_board_hidden: false,
  });
  if (error) throw new Error(`test rider: ${error.message}`);
  polyline = SKYLINE_REFERENCE_POLYLINE;
});

afterAll(async () => {
  await cleanup();
  await db.from("users").delete().eq("id", TEST_USER);
});

beforeEach(cleanup);
afterEach(cleanup);

describe("fixture segments", () => {
  it("agree with the corridor classifier, and the seed queued no jobs", async () => {
    const { data } = await db
      .from("segments")
      .select(
        "id, start_latlng, end_latlng, average_grade, corridor, direction",
      )
      .gte("id", 900_001)
      .lte("id", 900_008)
      .order("id");
    expect(data).toHaveLength(8);
    for (const s of data!) {
      const geo = s as unknown as Parameters<typeof classifySegmentCorridor>[0];
      expect([s.id, classifySegmentCorridor(geo)]).toEqual([s.id, s.corridor]);
      expect([s.id, segmentDirection(geo)]).toEqual([s.id, s.direction]);
    }
    const { count: pending } = await db
      .from("rides")
      .select("id", { count: "exact", head: true })
      .is("segment_efforts_fetched_at", null);
    expect(pending).toBe(0);
  });
});

describe("trigger: Skyline rides queue a segment_efforts job", () => {
  it("queues exactly one job per unfetched Skyline ride", async () => {
    const rideId = await insertRide(1);
    const j = await jobs();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({
      kind: "segment_efforts",
      user_id: TEST_USER,
      status: "queued",
      payload: { ride_id: rideId },
    });
  });

  it("ignores other routes until a ride is reclassified to Skyline", async () => {
    const rideId = await insertRide(2, { route_category: "bayway" });
    expect(await jobs()).toHaveLength(0);
    await db
      .from("rides")
      .update({ route_category: "skyline" })
      .eq("id", rideId);
    expect((await jobs("segment_efforts")).map((j) => j.payload)).toEqual([
      { ride_id: rideId },
    ]);
  });

  it("does not queue a second job when an unfetched ride is re-upserted", async () => {
    await insertRide(3);
    const { error } = await db.from("rides").upsert(
      {
        user_id: TEST_USER,
        strava_activity_id: ACTIVITY_BASE + 3,
        name: "renamed",
        ride_date: "2026-10-14",
        start_date: "2026-10-14T14:00:00Z",
        route_category: "skyline",
        summary_polyline: polyline,
      },
      { onConflict: "strava_activity_id" },
    );
    expect(error).toBeNull();
    expect(await jobs("segment_efforts")).toHaveLength(1);
  });

  it("does not queue rides whose efforts were already fetched", async () => {
    await insertRide(4, { segment_efforts_fetched_at: "2026-10-15T00:00:00Z" });
    expect(await jobs()).toHaveLength(0);
  });
});

describe("claim_sync_jobs", () => {
  it("claims rider backfills before segment work", async () => {
    await insertRide(5); // queues segment_efforts first
    await db.rpc("enqueue_sync_job", {
      p_kind: "segment_xoms",
      p_user_id: TEST_USER,
      p_payload: { segment_id: SEGMENT_BASE + 99 },
    });
    await db.rpc("enqueue_sync_job", {
      p_kind: "backfill",
      p_user_id: TEST_USER,
      p_cursor: { before: 1_700_000_000 },
    });
    // One at a time: UPDATE … RETURNING does not preserve the claim order.
    const claimed: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data, error } = await db.rpc("claim_sync_jobs", { n: 1 });
      expect(error).toBeNull();
      claimed.push(...data!.map((j: { kind: string }) => j.kind));
    }
    expect(claimed).toEqual(["backfill", "segment_efforts", "segment_xoms"]);
  });
});

describe("segmentEffortsStep", () => {
  it("stores the ride's bests, classifies and places corridor segments, and marks the ride fetched", async () => {
    const rideId = await insertRide(10);
    await db.from("sync_jobs").delete().gte("id", 0);
    const strava = mockStrava({
      activities: [detailActivity(ACTIVITY_BASE + 10)],
    });
    try {
      const r = await segmentEffortsStep(rideId, db as never);
      expect(r).toMatchObject({
        outcome: "efforts_stored",
        efforts: 4,
        segments: 4,
      });
      expect(
        strava.calls.filter((c) => c.includes("/api/v3/activities/")),
      ).toEqual([
        `GET /api/v3/activities/${ACTIVITY_BASE + 10}?include_all_efforts=true`,
      ]);

      const { data: segs } = await db
        .from("segments")
        .select("id, corridor, direction, terrain, in_core, sf2g_rides")
        .gte("id", SEGMENT_BASE)
        .lt("id", SEGMENT_BASE + 100)
        .order("id");
      expect(segs).toEqual([
        // line[10] is before John Daly Blvd (4.1 km): on Skyline, not in the core.
        {
          id: SEGMENT_BASE + 1,
          corridor: "skyline",
          direction: "south",
          terrain: "climb",
          in_core: false,
          sf2g_rides: 1,
        },
        {
          id: SEGMENT_BASE + 2,
          corridor: "skyline",
          direction: "south",
          terrain: "flat",
          in_core: true,
          sf2g_rides: 1,
        },
        {
          id: SEGMENT_BASE + 3,
          corridor: "skyline",
          direction: "north",
          terrain: "climb",
          in_core: true,
          sf2g_rides: 1,
        },
        {
          id: SEGMENT_BASE + 4,
          corridor: null,
          direction: "south",
          terrain: "climb",
          in_core: false,
          sf2g_rides: 1,
        },
      ]);

      // Phase 09: one best per segment, nothing per effort.
      const b = await bests({ ride: rideId });
      expect(b.map((x) => x.segment_id)).toEqual([
        SEGMENT_BASE + 1,
        SEGMENT_BASE + 2,
        SEGMENT_BASE + 3,
        SEGMENT_BASE + 4,
      ]);
      expect(b[0]).toMatchObject({
        effort_id: EFFORT_BASE + 1,
        user_id: TEST_USER,
        year: 2026,
        ride_date: "2026-10-14",
        elapsed_time_seconds: 301,
        kom_rank: 7,
        average_watts: 250,
        effort_count: 1,
        first_ride_date: "2026-10-14",
      });

      const { data: ride } = await db
        .from("rides")
        .select("segment_efforts_fetched_at")
        .eq("id", rideId)
        .single();
      expect(ride!.segment_efforts_fetched_at).not.toBeNull();

      // New corridor segments get a KOM refresh (capped at 3 per step).
      expect(
        (await jobs("segment_xoms")).map((j) => j.payload.segment_id).sort(),
      ).toEqual([SEGMENT_BASE + 1, SEGMENT_BASE + 2, SEGMENT_BASE + 3]);

      // Idempotent: a second run (e.g. a retried job) counts nothing twice.
      await segmentEffortsStep(rideId, db as never);
      expect(
        await count("segments", "id", SEGMENT_BASE, SEGMENT_BASE + 100),
      ).toBe(4);
      const again = await bests({ ride: rideId });
      expect(again.map((x) => x.effort_count)).toEqual([1, 1, 1, 1]);
      const { data: s1 } = await db
        .from("segments")
        .select("sf2g_rides")
        .eq("id", SEGMENT_BASE + 1)
        .single();
      expect(s1!.sf2g_rides).toBe(1);
      expect(await jobs("segment_xoms")).toHaveLength(3);
    } finally {
      strava.restore();
    }
  });

  it("never overwrites admin curation or KOM times on re-ingest", async () => {
    const rideId = await insertRide(11);
    const strava = mockStrava({
      activities: [detailActivity(ACTIVITY_BASE + 11)],
    });
    try {
      await segmentEffortsStep(rideId, db as never);
      await db
        .from("segments")
        .update({
          curated_rank: 1,
          hidden: true,
          kom_seconds: 289,
          xoms_fetched_at: "2026-10-20T00:00:00Z",
        })
        .eq("id", SEGMENT_BASE + 1);
      await db
        .from("rides")
        .update({ segment_efforts_fetched_at: null })
        .eq("id", rideId);
      await segmentEffortsStep(rideId, db as never);
      const { data } = await db
        .from("segments")
        .select("curated_rank, hidden, kom_seconds, xoms_fetched_at")
        .eq("id", SEGMENT_BASE + 1)
        .single();
      expect(data).toEqual({
        curated_rank: 1,
        hidden: true,
        kom_seconds: 289,
        xoms_fetched_at: "2026-10-20T00:00:00+00:00",
      });
    } finally {
      strava.restore();
    }
  });

  it("costs 3 subrequests with a valid token", async () => {
    const rideId = await insertRide(13);
    const strava = mockStrava({
      activities: [detailActivity(ACTIVITY_BASE + 13)],
    });
    try {
      await segmentEffortsStep(rideId, db as never);
      await db
        .from("segments")
        .update({ xoms_fetched_at: new Date().toISOString() })
        .gte("id", SEGMENT_BASE)
        .lt("id", SEGMENT_BASE + 100);
      await db
        .from("rides")
        .update({ segment_efforts_fetched_at: null })
        .eq("id", rideId);
      await db
        .from("users")
        .update({
          strava_token_expires_at: new Date(
            Date.now() + 3_600_000,
          ).toISOString(),
        })
        .eq("id", TEST_USER);
      const { subrequests } = await trackSubrequests(() =>
        segmentEffortsStep(rideId, db as never),
      );
      // ride + token read, Strava read, ingest_ride_segment_efforts
      expect(subrequests).toBe(3);
    } finally {
      strava.restore();
    }
  });

  it("marks a ride Strava no longer has as fetched and stores nothing", async () => {
    const rideId = await insertRide(12);
    const strava = mockStrava({ activities: [] });
    try {
      const r = await segmentEffortsStep(rideId, db as never);
      expect(r).toEqual({
        outcome: "ride_not_found",
        efforts: 0,
        segments: 0,
        rateLimited: false,
      });
      const { data: ride } = await db
        .from("rides")
        .select("segment_efforts_fetched_at")
        .eq("id", rideId)
        .single();
      expect(ride!.segment_efforts_fetched_at).not.toBeNull();
      expect(await bests({ ride: rideId })).toEqual([]);
      expect(
        await count("segments", "id", SEGMENT_BASE, SEGMENT_BASE + 100),
      ).toBe(0);
    } finally {
      strava.restore();
    }
  });

  it("reports a deleted ride without calling Strava", async () => {
    const strava = mockStrava({});
    try {
      const r = await segmentEffortsStep(
        "00000000-0000-4000-8000-00000000dead",
        db as never,
      );
      expect(r.outcome).toBe("ride_missing");
      expect(strava.calls).toEqual([]);
    } finally {
      strava.restore();
    }
  });
});

describe("segmentXomsStep", () => {
  async function insertSegment(i: number, over: Record<string, unknown> = {}) {
    const { error } = await db.from("segments").insert({
      id: SEGMENT_BASE + i,
      name: `Test segment ${i}`,
      distance_meters: 1500,
      average_grade: 4,
      start_latlng: line[10],
      end_latlng: line[30],
      corridor: "skyline",
      direction: "south",
      ...over,
    });
    if (error) throw new Error(`insert segment: ${error.message}`);
  }

  it("stores KOM, QOM and overall times in seconds", async () => {
    await insertSegment(20);
    const strava = mockStrava({
      segments: {
        [SEGMENT_BASE + 20]: {
          name: "Test segment 20",
          effort_count: 5000,
          athlete_count: 1200,
          xoms: { kom: "4:49", qom: "5:40", overall: "4:49" },
        },
      },
    });
    try {
      const r = await segmentXomsStep(
        SEGMENT_BASE + 20,
        TEST_USER,
        db as never,
      );
      expect(r).toEqual({ updated: true, rateLimited: false });
      const { data } = await db
        .from("segments")
        .select(
          "kom_seconds, qom_seconds, overall_seconds, effort_count, athlete_count, xoms_fetched_at",
        )
        .eq("id", SEGMENT_BASE + 20)
        .single();
      expect(data).toMatchObject({
        kom_seconds: 289,
        qom_seconds: 340,
        overall_seconds: 289,
        effort_count: 5000,
        athlete_count: 1200,
      });
      expect(data!.xoms_fetched_at).not.toBeNull();
    } finally {
      strava.restore();
    }
  });

  it("still marks the segment fetched when Strava has no xoms", async () => {
    await insertSegment(21);
    const strava = mockStrava({
      segments: { [SEGMENT_BASE + 21]: { name: "No xoms" } },
    });
    try {
      const r = await segmentXomsStep(
        SEGMENT_BASE + 21,
        TEST_USER,
        db as never,
      );
      expect(r).toEqual({ updated: false, rateLimited: false });
      const { data } = await db
        .from("segments")
        .select("kom_seconds, xoms_fetched_at")
        .eq("id", SEGMENT_BASE + 21)
        .single();
      expect(data!.kom_seconds).toBeNull();
      expect(data!.xoms_fetched_at).not.toBeNull();
    } finally {
      strava.restore();
    }
  });

  it("enqueue_due_segment_xoms queues stale, visible corridor segments with a usable token", async () => {
    await insertSegment(30); // never fetched
    await insertSegment(31, { xoms_fetched_at: new Date().toISOString() }); // fresh
    await insertSegment(32, { hidden: true });
    await insertSegment(33, { corridor: null });
    await insertSegment(34, { xoms_fetched_at: "2026-01-01T00:00:00Z" }); // stale
    const { data: created, error } = await db.rpc("enqueue_due_segment_xoms", {
      p_older_than: "7 days",
      p_limit: 100,
    });
    expect(error).toBeNull();
    const j = await jobs("segment_xoms");
    expect(created).toBe(j.length);
    const ids = j.map((x) => Number(x.payload.segment_id));
    expect(ids).toContain(SEGMENT_BASE + 30);
    expect(ids).toContain(SEGMENT_BASE + 34);
    expect(ids).not.toContain(SEGMENT_BASE + 31);
    expect(ids).not.toContain(SEGMENT_BASE + 32);
    expect(ids).not.toContain(SEGMENT_BASE + 33);

    const { data: tokenUser } = await db
      .from("users")
      .select("strava_refresh_token, needs_reauth, deauthorized_at")
      .eq("id", j[0].user_id!)
      .single();
    expect(tokenUser!.strava_refresh_token).not.toBe("");
    expect(tokenUser!.needs_reauth).toBe(false);
    expect(tokenUser!.deauthorized_at).toBeNull();
  });
});

describe("enqueue_segment_backfill", () => {
  it("queues the newest pending ride first, riders who hid their times last", async () => {
    const older = await insertRide(40, {
      ride_date: "2025-03-01",
      start_date: "2025-03-01T15:00:00Z",
    });
    await insertRide(41, {
      ride_date: "2024-03-01",
      start_date: "2024-03-01T15:00:00Z",
    });
    // A newer pending ride from a rider who hid their times must wait.
    await db.from("rides").insert({
      user_id: RIDER.ivy,
      strava_activity_id: ACTIVITY_BASE + 42,
      name: "Opted-out Skyline",
      ride_date: "2026-10-15",
      start_date: "2026-10-15T14:00:00Z",
      route_category: "skyline",
      summary_polyline: polyline,
    });
    await db.from("sync_jobs").delete().gte("id", 0);

    const { data, error } = await db.rpc("enqueue_segment_backfill", {
      p_limit: 1,
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await jobs("segment_efforts")).map((j) => j.payload)).toEqual([
      { ride_id: older },
    ]);

    // Already-queued rides are not counted twice.
    const { data: again } = await db.rpc("enqueue_segment_backfill", {
      p_limit: 3,
    });
    expect(again).toBe(2);
  });
});

describe("segments admin", () => {
  it("backfill and stats are single calls with consistent counts", async () => {
    await insertRide(60);
    await insertRide(61);
    await db.from("sync_jobs").delete().gte("id", 0);
    const before = await fetchSegmentIngestStatsImpl();
    expect(before.open_jobs).toBe(0);
    const { result, subrequests } = await trackSubrequests(() =>
      enqueueSegmentBackfillImpl({ limit: 1 }),
    );
    expect(result).toEqual({ enqueued: 1 });
    expect(subrequests).toBe(1);
    const after = await fetchSegmentIngestStatsImpl();
    expect(after.open_jobs).toBe(1);
    expect(after.rides_pending).toBe(before.rides_pending);
    expect(Object.keys(after).sort()).toEqual([
      "bests",
      "failed_jobs",
      "open_jobs",
      "rides_fetched",
      "rides_pending",
      "segments_core",
      "segments_corridor",
      "segments_selectable",
      "segments_total",
    ]);
  });
});

describe("drain runs both job kinds", () => {
  it("runJob returns done for segment_efforts and segment_xoms", async () => {
    const rideId = await insertRide(50);
    const strava = mockStrava({
      activities: [detailActivity(ACTIVITY_BASE + 50)],
      segments: {
        [SEGMENT_BASE + 1]: { name: "s1", xoms: { kom: "4:49" } },
      },
    });
    try {
      const r1 = await runJob(
        {
          id: 0,
          kind: "segment_efforts",
          user_id: TEST_USER,
          payload: { ride_id: rideId },
        } as never,
        db as never,
      );
      expect(r1).toEqual({
        status: "done",
        detail: "efforts_stored: 4 efforts",
        ridesChanged: false,
        rateLimited: false,
      });
      const r2 = await runJob(
        {
          id: 0,
          kind: "segment_xoms",
          user_id: TEST_USER,
          payload: { segment_id: SEGMENT_BASE + 1 },
        } as never,
        db as never,
      );
      expect(r2).toMatchObject({ status: "done", detail: "xoms updated" });
    } finally {
      strava.restore();
    }
  });

  it("the drain finishes a queued segment_efforts job end to end", async () => {
    const rideId = await insertRide(51);
    const strava = mockStrava({
      activities: [detailActivity(ACTIVITY_BASE + 51)],
    });
    try {
      const r = await drainSyncJobs(defaultDrainDeps(() => 0));
      expect(r.jobs[0]).toMatchObject({
        kind: "segment_efforts",
        status: "done",
      });
      expect(await bests({ ride: rideId })).toHaveLength(4);
    } finally {
      strava.restore();
    }
  });

  it("stops the tick when a finished segment step reports Strava near its limit", async () => {
    await insertRide(52);
    await insertRide(53);
    const ran: number[] = [];
    const r = await drainSyncJobs({
      ...defaultDrainDeps(() => 0),
      run: async (job) => {
        ran.push(job.id);
        return {
          status: "done",
          detail: "ok",
          ridesChanged: false,
          rateLimited: true,
        };
      },
    });
    expect(ran).toHaveLength(1);
    expect(r.rateLimited).toBe(true);
    expect(r.stopReason).toBe("rate_limited");
    const open = (await jobs("segment_efforts")).filter(
      (j) => j.status === "queued",
    );
    expect(open).toHaveLength(1);
    expect(open[0].attempts).toBe(0); // released, not penalized
  });
});

// ---------------------------------------------------------------------------
// Phase 09a: PRs only
// ---------------------------------------------------------------------------
/** A ride whose efforts are given explicitly: [segment index, seconds][]. */
function ridesEfforts(
  activityId: number,
  efforts: Array<[number, number]>,
): MockActivity {
  const base = detailActivity(activityId);
  const segs = new Map<number, StravaSegmentSummary>();
  const seg = (i: number) => {
    if (!segs.has(i))
      segs.set(i, summary(i, line[40 + i], line[60 + i], { average_grade: 3 }));
    return segs.get(i)!;
  };
  return {
    ...base,
    segment_efforts: efforts.map(([i, seconds], k) => ({
      ...effort(0, seg(i)),
      id: EFFORT_BASE + activityId - ACTIVITY_BASE + k * 1000,
      elapsed_time: seconds,
      kom_rank: null,
    })),
  };
}

async function ingest(
  n: number,
  efforts: Array<[number, number]>,
  ride: Record<string, unknown> = {},
): Promise<string> {
  const rideId = await insertRide(n, ride);
  const strava = mockStrava({
    activities: [ridesEfforts(ACTIVITY_BASE + n, efforts)],
  });
  try {
    await segmentEffortsStep(rideId, db as never);
  } finally {
    strava.restore();
  }
  return rideId;
}

describe("segment_bests", () => {
  it("laps of one segment in one ride store one best with every effort counted", async () => {
    const rideId = await ingest(70, [
      [1, 320],
      [1, 305],
      [1, 330],
    ]);
    const b = await bests({ ride: rideId });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      segment_id: SEGMENT_BASE + 1,
      elapsed_time_seconds: 305,
      effort_count: 3,
    });
  });

  it("a slower later ride keeps the best and adds to the count; a faster one replaces it", async () => {
    const first = await ingest(71, [[1, 300]], {
      ride_date: "2026-03-01",
      start_date: "2026-03-01T15:00:00Z",
    });
    await ingest(72, [[1, 320]], {
      ride_date: "2026-04-01",
      start_date: "2026-04-01T15:00:00Z",
    });
    let b = await bests({ user: TEST_USER });
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      ride_id: first,
      elapsed_time_seconds: 300,
      effort_count: 2,
      first_ride_date: "2026-03-01",
      ride_date: "2026-03-01",
    });

    const faster = await ingest(73, [[1, 290]], {
      ride_date: "2026-02-01",
      start_date: "2026-02-01T15:00:00Z",
    });
    b = await bests({ user: TEST_USER });
    expect(b[0]).toMatchObject({
      ride_id: faster,
      elapsed_time_seconds: 290,
      effort_count: 3,
      first_ride_date: "2026-02-01",
    });
  });

  it("keeps one best per calendar year", async () => {
    await ingest(74, [[1, 300]], {
      ride_date: "2025-06-01",
      start_date: "2025-06-01T15:00:00Z",
    });
    await ingest(75, [[1, 310]], {
      ride_date: "2026-06-01",
      start_date: "2026-06-01T15:00:00Z",
    });
    const b = await bests({ user: TEST_USER });
    expect(b.map((x) => [x.year, x.elapsed_time_seconds])).toEqual([
      [2025, 300],
      [2026, 310],
    ]);
  });

  it("a private or hidden ride stores no bests but is marked fetched", async () => {
    const priv = await ingest(76, [[1, 250]], { is_private: true });
    const hid = await ingest(77, [[2, 250]], { is_hidden: true });
    expect(await bests({ user: TEST_USER })).toEqual([]);
    const { data } = await db
      .from("rides")
      .select("segment_efforts_fetched_at")
      .in("id", [priv, hid]);
    expect(data!.every((r) => r.segment_efforts_fetched_at !== null)).toBe(
      true,
    );
  });

  it("deleting the ride that holds a best drops that year's bests and re-queues the rider's other rides that year", async () => {
    const best = await ingest(78, [[1, 290]], {
      ride_date: "2026-03-01",
      start_date: "2026-03-01T15:00:00Z",
    });
    const other = await ingest(79, [[1, 300]], {
      ride_date: "2026-04-01",
      start_date: "2026-04-01T15:00:00Z",
    });
    const lastYear = await ingest(80, [[1, 310]], {
      ride_date: "2025-04-01",
      start_date: "2025-04-01T15:00:00Z",
    });
    await db.from("rides").delete().eq("id", best);

    expect((await bests({ user: TEST_USER })).map((x) => x.year)).toEqual([
      2025,
    ]);
    const { data } = await db
      .from("rides")
      .select("id, segment_efforts_fetched_at")
      .in("id", [other, lastYear]);
    const fetched = Object.fromEntries(
      data!.map((r) => [r.id, r.segment_efforts_fetched_at]),
    );
    expect(fetched[other]).toBeNull();
    expect(fetched[lastYear]).not.toBeNull();

    // The backfill rebuilds the year exactly from the remaining rides.
    const strava = mockStrava({
      activities: [ridesEfforts(ACTIVITY_BASE + 79, [[1, 300]])],
    });
    try {
      await segmentEffortsStep(other, db as never);
    } finally {
      strava.restore();
    }
    const rebuilt = await bests({ user: TEST_USER });
    expect(
      rebuilt.map((x) => [x.year, x.elapsed_time_seconds, x.effort_count]),
    ).toEqual([
      [2025, 310, 1],
      [2026, 300, 1],
    ]);
  });

  it("making the best's ride private drops the year; making it public again refetches it", async () => {
    const rideId = await ingest(81, [[1, 290]]);
    await db.from("rides").update({ is_private: true }).eq("id", rideId);
    expect(await bests({ user: TEST_USER })).toEqual([]);
    let { data: r } = await db
      .from("rides")
      .select("segment_efforts_fetched_at")
      .eq("id", rideId)
      .single();
    expect(r!.segment_efforts_fetched_at).not.toBeNull();

    await db.from("rides").update({ is_private: false }).eq("id", rideId);
    ({ data: r } = await db
      .from("rides")
      .select("segment_efforts_fetched_at")
      .eq("id", rideId)
      .single());
    expect(r!.segment_efforts_fetched_at).toBeNull();
  });

  it("anon cannot read segment_bests", async () => {
    const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);
    const { data, error } = await anon.from("segment_bests").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe("plan_segment_jobs", () => {
  it("tops up the backfill only while fewer than 5 segment_efforts jobs are open", async () => {
    for (let i = 0; i < 7; i++)
      await insertRide(90 + i, {
        segment_efforts_fetched_at: "2026-10-15T00:00:00Z",
      });
    await db
      .from("rides")
      .update({ segment_efforts_fetched_at: null })
      .gte("strava_activity_id", ACTIVITY_BASE + 90)
      .lt("strava_activity_id", ACTIVITY_BASE + 97);
    // Nothing open → 5 queued.
    const { data: a } = await db.rpc("plan_segment_jobs", {
      p_xoms_limit: 0,
      p_backfill: 5,
      p_max_open: 5,
    });
    expect(a).toMatchObject({ backfill: 5, open: 0 });
    // 5 open → none.
    const { data: b } = await db.rpc("plan_segment_jobs", {
      p_xoms_limit: 0,
      p_backfill: 5,
      p_max_open: 5,
    });
    expect(b).toMatchObject({ backfill: 0, open: 5 });
    expect(await jobs("segment_efforts")).toHaveLength(5);
  });
});

describe("curateSelectableSegments", () => {
  it("costs 2 subrequests and selects only core, non-descent corridor segments", async () => {
    const { data: before } = await db
      .from("segments")
      .select("id, selectable, duplicate_of")
      .gte("id", 900_001)
      .lte("id", 900_008);
    try {
      const { result, subrequests } = await trackSubrequests(() =>
        curateSelectableSegmentsImpl({ corridor: "skyline" }),
      );
      expect(subrequests).toBe(2);
      expect(result.corridor).toBe("skyline");
      const { data } = await db
        .from("segments")
        .select("id, selectable")
        .gte("id", 900_001)
        .lte("id", 900_008)
        .order("id");
      const chosen = data!.filter((s) => s.selectable).map((s) => s.id);
      // 900001 is before John Daly Blvd, 900006 a descent, 900008 off the line.
      for (const id of chosen)
        expect([900002, 900003, 900004, 900005, 900007]).toContain(id);
      expect(chosen).not.toContain(900001);
    } finally {
      for (const row of before!)
        await db
          .from("segments")
          .update({
            selectable: row.selectable,
            duplicate_of: row.duplicate_of,
          })
          .eq("id", row.id);
    }
  });
});
