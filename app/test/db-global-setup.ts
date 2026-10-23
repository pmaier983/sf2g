/**
 * Global setup for the `db` Vitest project.
 *
 * Requires a local Supabase (`pnpm db:start`). Ensures the fixture dataset is
 * loaded (resets the database when it isn't, or when SF2G_DB_RESET=1), then
 * refreshes every materialized view and precomputes group rides so view-backed
 * code paths have data.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_SUPABASE } from "./local-supabase";

const ROOT = resolve(__dirname, "../..");

async function fixtureLoaded(): Promise<boolean> {
  const expected = JSON.parse(
    readFileSync(resolve(ROOT, "supabase/seed/EXPECTED.json"), "utf8"),
  ) as { totals: { rides: number; riders: number } };
  const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
  const [{ count: rides }, { count: riders }] = await Promise.all([
    db.from("rides").select("id", { count: "exact", head: true }),
    db.from("users").select("id", { count: "exact", head: true }),
  ]);
  return rides === expected.totals.rides && riders === expected.totals.riders;
}

export default async function setup(): Promise<void> {
  try {
    const res = await fetch(`${LOCAL_SUPABASE.url}/rest/v1/`, {
      headers: { apikey: LOCAL_SUPABASE.anonKey },
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `Local Supabase is not reachable at ${LOCAL_SUPABASE.url} (${String(err)}). Run \`pnpm db:start\` first.`,
    );
  }

  if (process.env.SF2G_DB_RESET === "1" || !(await fixtureLoaded())) {
    console.log("[db-setup] resetting local database with fixtures…");
    execSync("supabase db reset", { cwd: ROOT, stdio: "inherit" });
  }

  process.env.SUPABASE_URL = LOCAL_SUPABASE.url;
  process.env.SUPABASE_ANON_KEY = LOCAL_SUPABASE.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SUPABASE.serviceRoleKey;

  const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
  for (const fn of [
    "refresh_leaderboard",
    "refresh_company_leaderboard",
    "refresh_route_speed_leaderboard",
    "refresh_ppr_dawn_rides",
    "refresh_ride_co_occurrences",
  ]) {
    const { error } = await db.rpc(fn as never);
    if (error) throw new Error(`${fn}: ${error.message}`);
  }

  const { computeAndStoreGroupRides } = await import("../server/group-rides");
  await computeAndStoreGroupRides();
}
