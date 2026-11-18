/**
 * Phase 09b: the admin reference-ride tool against the fixture database.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { RIDER } from "../../../test/characterize";
import { mockStrava } from "../../../test/strava-mock";
import { trackSubrequests } from "../../../lib/perf";
import { decodePolyline } from "../../../lib/polyline";
import { rankTypicalRides } from "../../../lib/corridor-reference";
import {
  fetchCorridorReferenceCandidatesImpl,
  fetchCorridorStreamsImpl,
} from "../../corridor-reference";

process.env.STRAVA_CLIENT_ID = "test-client";
process.env.STRAVA_CLIENT_SECRET = "test-secret";
const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);

describe("corridor reference candidates", () => {
  it("returns the newest public SF→G rides of a route in one request", async () => {
    const { result, subrequests } = await trackSubrequests(() =>
      fetchCorridorReferenceCandidatesImpl({ category: "bayway", limit: 20 }),
    );
    expect(subrequests).toBe(1);
    expect(result.length).toBeGreaterThan(3);
    expect(result.length).toBeLessThanOrEqual(20);
    const dates = result.map((r) => r.ride_date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const ids = result.map((r) => r.ride_id);
    const { data } = await db
      .from("rides")
      .select("route_category, is_private, is_hidden, commute_direction")
      .in("id", ids);
    for (const r of data!) {
      expect(r.route_category).toBe("bayway");
      expect(r.is_private).not.toBe(true);
      expect(r.is_hidden).not.toBe(true);
      expect(r.commute_direction ?? "sf2g").toBe("sf2g");
    }
  });

  it("the fixture's candidates rank without error", async () => {
    const c = await fetchCorridorReferenceCandidatesImpl({
      category: "bayway",
    });
    const ranked = rankTypicalRides(
      c.map((x) => ({
        id: x.ride_id,
        line: decodePolyline(x.summary_polyline),
      })),
    );
    expect(ranked.length).toBeGreaterThan(0);
    expect(Number.isFinite(ranked[0].scoreM)).toBe(true);
  });

  it("anon cannot call it", async () => {
    const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);
    const { error } = await anon.rpc("corridor_reference_candidates", {
      p_category: "bayway",
    });
    expect(error).not.toBeNull();
  });
});

describe("fetchCorridorStreams", () => {
  // A throwaway rider (a copy of Ada) and ride: fetching streams may refresh
  // the rider's token, which would touch a fixture rider's row.
  const TEST_USER = "00000000-0000-4000-8000-0000000000fd";
  let rideId = "";
  const ACTIVITY = 1_850_000_002;

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
      strava_id: 7_999_997,
      username: "reference-test",
    });
    if (error) throw new Error(`test rider: ${error.message}`);
    const { data, error: rErr } = await db
      .from("rides")
      .insert({
        user_id: TEST_USER,
        strava_activity_id: ACTIVITY,
        name: "Bayway reference test",
        ride_date: "2026-10-14",
        start_date: "2026-10-14T14:00:00Z",
        route_category: "bayway",
        segment_efforts_fetched_at: "2026-10-14T15:00:00Z",
      })
      .select("id")
      .single();
    if (rErr) throw new Error(rErr.message);
    rideId = data.id;
  });

  afterAll(async () => {
    await db.from("users").delete().eq("id", TEST_USER);
  });

  it("fetches the chosen ride's streams with its rider's token and stores nothing", async () => {
    const body = {
      distance: { data: [0, 10] },
      altitude: { data: [5, 6] },
      latlng: {
        data: [
          [37.7, -122.4],
          [37.69, -122.4],
        ],
      },
    };
    const strava = mockStrava({ streams: { [ACTIVITY]: body } });
    try {
      const res = await fetchCorridorStreamsImpl({ rideId });
      expect(res.activityId).toBe(ACTIVITY);
      expect(res.streams).toEqual(body);
      expect(strava.calls.filter((c) => c.includes("/streams"))).toEqual([
        `GET /api/v3/activities/${ACTIVITY}/streams?keys=distance,altitude,latlng&key_by_type=true`,
      ]);
    } finally {
      strava.restore();
    }
  });

  it("refuses a private ride", async () => {
    await db.from("rides").update({ is_private: true }).eq("id", rideId);
    await expect(fetchCorridorStreamsImpl({ rideId })).rejects.toThrow(
      /private/,
    );
  });
});
