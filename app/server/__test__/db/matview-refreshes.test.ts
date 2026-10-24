/**
 * The queue's refresh_views job (MATERIALIZED_VIEW_REFRESHES) refreshes
 * every materialized view that still exists. Regression: the PPR MV once
 * went unrefreshed and the PPR filter showed stale data. Migration 042
 * dropped the MVs nothing read; their refresh functions must stay gone.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { MATERIALIZED_VIEW_REFRESHES } from "../../cron";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);

describe("materialized view refreshes", () => {
  it("each refresh in the list exists and runs", async () => {
    for (const fn of MATERIALIZED_VIEW_REFRESHES) {
      const { error } = await db.rpc(fn as never);
      expect(error, fn).toBeNull();
    }
  });

  it("the unused MVs and their refreshes are gone (042)", async () => {
    for (const fn of [
      "refresh_leaderboard",
      "refresh_company_leaderboard",
      "refresh_ppr_dawn_rides",
      "refresh_route_speed_leaderboard",
    ]) {
      const { error } = await db.rpc(fn as never);
      expect(error, fn).not.toBeNull();
    }
  });

  it("anon can't read ride pair data directly, but the network still works", async () => {
    const { error: mvError } = await anon
      .from("ride_co_occurrences" as never)
      .select("*")
      .limit(1);
    expect(mvError).not.toBeNull();
    const { data, error } = await anon.rpc("get_rider_network");
    expect(error).toBeNull();
    expect((data as { riders: unknown[] }).riders.length).toBeGreaterThan(0);
  });
});
