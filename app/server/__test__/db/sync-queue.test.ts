/**
 * Phase 04: webhook → queue → drain, against the local fixture database with
 * the Strava API mocked at the fetch level.
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
import { processWebhookEvent, type StravaWebhookEvent } from "../../webhook";
import {
  drainSyncJobs,
  defaultDrainDeps,
  DRAIN_BUDGET,
  backoffMinutes,
  runJob,
} from "../../sync-drain";
import { fetchLeaderboardImpl } from "../../leaderboard";
import { MATERIALIZED_VIEW_REFRESHES } from "../../cron";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
/**
 * A throwaway rider (a copy of Ada's account) so these tests never change a
 * fixture rider that the characterization goldens read.
 */
const TEST_USER = "00000000-0000-4000-8000-0000000000ff";
const TEST_STRAVA_ID = 7_999_999;
const TEST_ACTIVITY_BASE = 1_800_000_000;

process.env.STRAVA_CLIENT_ID = "test-client";
process.env.STRAVA_CLIENT_SECRET = "test-secret";

function event(over: Partial<StravaWebhookEvent>): StravaWebhookEvent {
  return {
    object_type: "activity",
    aspect_type: "create",
    object_id: TEST_ACTIVITY_BASE + 1,
    owner_id: TEST_STRAVA_ID,
    subscription_id: 1,
    event_time: 1_790_000_000,
    updates: {},
    ...over,
  };
}

async function adaTemplate(): Promise<{ polyline: string }> {
  const { data } = await db
    .from("rides")
    .select("summary_polyline")
    .eq("user_id", RIDER.ada)
    .eq("route_category", "bayway")
    .limit(1)
    .single();
  return { polyline: data!.summary_polyline! };
}

function activity(
  id: number,
  date: string,
  polyline: string,
  type = "Ride",
): MockActivity {
  return {
    id,
    name: `Test ride ${id}`,
    type,
    start_date: `${date}T14:00:00Z`,
    start_date_local: `${date}T07:00:00Z`,
    timezone: "(GMT-08:00) America/Los_Angeles",
    distance: 48_000,
    moving_time: 7_200,
    elapsed_time: 8_000,
    total_elevation_gain: 180,
    average_speed: 6.6,
    max_speed: 14,
    start_latlng: [37.7599, -122.4148],
    end_latlng: [37.4419, -122.143],
    map: { summary_polyline: polyline },
  };
}

async function jobs() {
  const { data } = await db.from("sync_jobs").select("*").order("id");
  return data ?? [];
}

async function cleanup() {
  await db.from("sync_jobs").delete().gte("id", 0);
  await db
    .from("rides")
    .delete()
    .gte("strava_activity_id", TEST_ACTIVITY_BASE)
    .lt("strava_activity_id", TEST_ACTIVITY_BASE + 10_000);
  await db
    .from("users")
    .update({
      needs_reauth: false,
      last_sync_error: null,
      strava_token_expires_at: "2026-10-16T18:00:00Z",
    })
    .eq("id", TEST_USER);
}

beforeAll(async () => {
  const { data: ada } = await db
    .from("users")
    .select("*")
    .eq("id", RIDER.ada)
    .single();
  // display_name is generated from the name columns
  const { display_name: _generated, ...row } = ada!;
  const { error } = await db.from("users").insert({
    ...row,
    id: TEST_USER,
    strava_id: TEST_STRAVA_ID,
    username: "sync-queue-test",
  });
  if (error) throw new Error(`test rider: ${error.message}`);
});

afterAll(async () => {
  await db.from("users").delete().eq("id", TEST_USER);
  // Rebuild derived data without the test rider's rides.
  for (const fn of MATERIALIZED_VIEW_REFRESHES) await db.rpc(fn as never);
  await db.rpc("recompute_group_rides");
});

beforeEach(cleanup);
afterEach(cleanup);

describe("claim_sync_jobs", () => {
  it("claims at most n jobs, webhook jobs first", async () => {
    for (let i = 0; i < 6; i++) {
      await db.rpc("enqueue_sync_job", {
        p_kind: "webhook_activity",
        p_user_id: TEST_USER,
        p_payload: { activity_id: TEST_ACTIVITY_BASE + 100 + i },
      });
    }
    await db.rpc("enqueue_sync_job", { p_kind: "refresh_views" });
    const { data, error } = await db.rpc("claim_sync_jobs", { n: 2 });
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(
      data!.every((j: { kind: string }) => j.kind === "webhook_activity"),
    ).toBe(true);
    expect((await jobs()).filter((j) => j.status === "running")).toHaveLength(
      2,
    );
  });
});

describe("webhook records work and acknowledges", () => {
  it("queues one job per activity, deduplicates, ignores unknown athletes", async () => {
    expect((await processWebhookEvent(event({}))).action_taken).toBe(
      "activity_queued",
    );
    expect(
      (await processWebhookEvent(event({ aspect_type: "update" })))
        .action_taken,
    ).toBe("activity_already_queued");
    expect(
      (await processWebhookEvent(event({ owner_id: 1 }))).action_taken,
    ).toBe("ignored_unknown_user");
    const j = await jobs();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({
      kind: "webhook_activity",
      user_id: TEST_USER,
      status: "queued",
    });
  });

  it("deletes a ride on activity.delete and queues a view refresh", async () => {
    const { polyline } = await adaTemplate();
    await db.from("rides").insert({
      user_id: TEST_USER,
      strava_activity_id: TEST_ACTIVITY_BASE + 2,
      name: "to delete",
      ride_date: "2026-10-14",
      start_date: "2026-10-14T14:00:00Z",
      route_category: "bayway",
      summary_polyline: polyline,
    });
    const res = await processWebhookEvent(
      event({ aspect_type: "delete", object_id: TEST_ACTIVITY_BASE + 2 }),
    );
    expect(res.action_taken).toBe("ride_deleted");
    const { count } = await db
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("strava_activity_id", TEST_ACTIVITY_BASE + 2);
    expect(count).toBe(0);
    expect((await jobs()).map((j) => j.kind)).toEqual(["refresh_views"]);
  });

  it("ignores events for another subscription when one is configured", async () => {
    process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID = "999";
    try {
      expect(
        (await processWebhookEvent(event({ subscription_id: 1 }))).action_taken,
      ).toBe("ignored_subscription");
      expect(await jobs()).toHaveLength(0);
    } finally {
      delete process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
    }
  });
});

describe("drain: webhook ride reaches the leaderboard", () => {
  it("fetches, stores and (after the queued refresh) counts the new ride", async () => {
    const { polyline } = await adaTemplate();
    const strava = mockStrava({
      activities: [activity(TEST_ACTIVITY_BASE + 3, "2026-10-15", polyline)],
    });
    try {
      const before = (
        await fetchLeaderboardImpl({ excludeWeekends: false })
      ).find((r) => r.user_id === TEST_USER);
      await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 3 }));

      let count = 0;
      const r1 = await drainSyncJobs(defaultDrainDeps(() => count++));
      expect(r1.done).toBe(1);
      const { data: ride } = await db
        .from("rides")
        .select("route_category")
        .eq("strava_activity_id", TEST_ACTIVITY_BASE + 3)
        .single();
      expect(ride?.route_category).toBe("bayway");

      // The drain queued refresh_views (and that queues recompute_groups)
      expect(
        (await jobs()).filter((j) => j.status === "queued").map((j) => j.kind),
      ).toEqual(["refresh_views"]);
      await drainSyncJobs(defaultDrainDeps(() => count++));
      expect(
        (await jobs()).filter((j) => j.status === "queued").map((j) => j.kind),
      ).toEqual(["recompute_groups"]);

      const after = (
        await fetchLeaderboardImpl({ excludeWeekends: false })
      ).find((r) => r.user_id === TEST_USER)!;
      expect(after.sf2g_total).toBe((before?.sf2g_total ?? 0) + 1);
      expect(strava.calls.some((c) => c.startsWith("POST /oauth/token"))).toBe(
        true,
      ); // expired token refreshed
    } finally {
      strava.restore();
    }
  });

  it("does not store non-ride activities", async () => {
    const { polyline } = await adaTemplate();
    const strava = mockStrava({
      activities: [
        activity(TEST_ACTIVITY_BASE + 4, "2026-10-15", polyline, "Run"),
      ],
    });
    try {
      await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 4 }));
      const r = await drainSyncJobs(defaultDrainDeps(() => 0));
      expect(r.jobs[0].detail).toBe("skipped_not_a_ride");
      const { count } = await db
        .from("rides")
        .select("id", { count: "exact", head: true })
        .eq("strava_activity_id", TEST_ACTIVITY_BASE + 4);
      expect(count).toBe(0);
    } finally {
      strava.restore();
    }
  });
});

describe("drain: backfill pages backwards until history is complete", () => {
  it("imports older rides page by page and finishes", async () => {
    const { polyline } = await adaTemplate();
    const older = Array.from({ length: 150 }, (_, i) =>
      activity(
        TEST_ACTIVITY_BASE + 100 + i,
        `2016-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        polyline,
      ),
    );
    const strava = mockStrava({ activities: older });
    try {
      await db.rpc("enqueue_sync_job", {
        p_kind: "backfill",
        p_user_id: TEST_USER,
        p_cursor: { before: Math.floor(Date.parse("2017-01-01") / 1000) },
      });
      const first = await drainSyncJobs(defaultDrainDeps(() => 0));
      expect(first.requeued).toBe(1); // 100 of 150 → more to go
      await drainSyncJobs(defaultDrainDeps(() => 0));
      const backfill = (await jobs()).find((j) => j.kind === "backfill");
      expect(backfill?.status).toBe("done");
      const { count } = await db
        .from("rides")
        .select("id", { count: "exact", head: true })
        .gte("strava_activity_id", TEST_ACTIVITY_BASE + 100)
        .lt("strava_activity_id", TEST_ACTIVITY_BASE + 250);
      expect(count).toBe(150);
    } finally {
      strava.restore();
    }
  });
});

describe("drain: failures, budgets and re-auth", () => {
  it("marks the rider needs_reauth and fails the job when the refresh token is rejected", async () => {
    const strava = mockStrava({ refresh: "invalid_grant" });
    try {
      await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 5 }));
      const r = await drainSyncJobs(defaultDrainDeps(() => 0));
      expect(r.failed).toBe(1);
      expect(r.needsReauth).toBe(1);
      const { data: u } = await db
        .from("users")
        .select("needs_reauth")
        .eq("id", TEST_USER)
        .single();
      expect(u?.needs_reauth).toBe(true);
    } finally {
      strava.restore();
    }
  });

  it("retries (does not fail or flag the rider) when Strava itself errors", async () => {
    const strava = mockStrava({ refresh: "server_error" });
    try {
      await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 6 }));
      const r = await drainSyncJobs(defaultDrainDeps(() => 0));
      expect(r.requeued).toBe(1);
      const [job] = await jobs();
      expect(job.status).toBe("queued");
      expect(Date.parse(job.run_after)).toBeGreaterThan(Date.now() + 30_000); // backed off
      const { data: u } = await db
        .from("users")
        .select("needs_reauth")
        .eq("id", TEST_USER)
        .single();
      expect(u?.needs_reauth).toBe(false);
    } finally {
      strava.restore();
    }
  });

  it("fails a job for good after MAX_ATTEMPTS", async () => {
    await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 7 }));
    await db
      .from("sync_jobs")
      .update({ attempts: DRAIN_BUDGET.MAX_ATTEMPTS - 1 })
      .gte("id", 0);
    const r = await drainSyncJobs({
      ...defaultDrainDeps(() => 0),
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(r.failed).toBe(1);
    expect((await jobs())[0].status).toBe("failed");
  });

  it("stops before the subrequest budget and releases unstarted jobs", async () => {
    for (let i = 0; i < 4; i++)
      await processWebhookEvent(
        event({ object_id: TEST_ACTIVITY_BASE + 10 + i }),
      );
    let used = 1;
    const ran: number[] = [];
    const r = await drainSyncJobs({
      ...defaultDrainDeps(() => used),
      subrequests: () => used,
      run: async (job) => {
        ran.push(job.id);
        used += 15;
        return { status: "done", detail: "ok", ridesChanged: false };
      },
    });
    // starts while used + 10 ≤ 44: 1 → 16 → 31 run; 46 + 10 > 44 → stop
    expect(ran).toHaveLength(3);
    expect(r.stopReason).toBe("subrequest_budget");
    const open = (await jobs()).filter((j) => j.status === "queued");
    expect(open).toHaveLength(1);
    expect(open.every((j) => j.attempts === 0)).toBe(true); // released, not penalized
  });

  it("rate limits re-queue the job 15 minutes out without counting an attempt", async () => {
    await processWebhookEvent(event({ object_id: TEST_ACTIVITY_BASE + 20 }));
    const r = await drainSyncJobs({
      ...defaultDrainDeps(() => 0),
      run: async () => {
        throw new Error("RATE_LIMITED: near limit");
      },
    });
    expect(r.rateLimited).toBe(true);
    const [job] = await jobs();
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(Date.parse(job.run_after) - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it("backs off exponentially", () => {
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16]);
  });
});

describe("maintenance jobs", () => {
  it("refresh_views and recompute_groups run as single calls", async () => {
    const r1 = await runJob(
      { id: 0, kind: "refresh_views" } as never,
      db as never,
    );
    expect(r1.status).toBe("done");
    const r2 = await runJob(
      { id: 0, kind: "recompute_groups" } as never,
      db as never,
    );
    expect(r2.detail).toMatch(/group rides/);
  });
});
