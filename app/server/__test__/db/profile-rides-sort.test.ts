/**
 * T14: the profile rides table sorted only the current page of 25 in the
 * browser, so "longest ride" meant "longest ride on this page". Sorting is
 * now applied by the server across all of the rider's rides.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { RIDER } from "../../../test/characterize";
import { fetchUserRidesImpl } from "../../rides";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);

describe("fetchUserRides sort (T14)", () => {
  it("first page sorted by distance is the rider's longest rides overall", async () => {
    const { data: all } = await db
      .from("rides")
      .select("distance_meters")
      .eq("user_id", RIDER.ada)
      .not("distance_meters", "is", null)
      .order("distance_meters", { ascending: false })
      .limit(5);
    const page = await fetchUserRidesImpl({
      userId: RIDER.ada,
      includeAllRides: true,
      includeHidden: true,
      limit: 5,
      offset: 0,
      sortBy: "distance_meters",
      sortDir: "desc",
    });
    expect(page.map((r) => r.distance_meters)).toEqual(
      all!.map((r) => r.distance_meters),
    );
  });

  it("puts empty values last in both directions", async () => {
    for (const sortDir of ["asc", "desc"] as const) {
      const rides = await fetchUserRidesImpl({
        userId: RIDER.ada,
        includeAllRides: true,
        includeHidden: true,
        limit: 1000,
        sortBy: "average_speed_mps",
        sortDir,
      });
      const firstNull = rides.findIndex((r) => r.average_speed_mps == null);
      if (firstNull >= 0)
        expect(
          rides.slice(firstNull).every((r) => r.average_speed_mps == null),
        ).toBe(true);
    }
  });

  it("ignores an unknown sort column (falls back to newest first)", async () => {
    const rides = await fetchUserRidesImpl({
      userId: RIDER.ada,
      includeAllRides: true,
      limit: 3,
      sortBy: "strava_access_token; drop table rides",
      sortDir: "asc",
    });
    const dates = rides.map((r) => r.ride_date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
