/**
 * Global setup for the `db` Vitest project.
 *
 * Requires a local Supabase (`pnpm db:start`). Ensures the database matches
 * this checkout — every file in `supabase/migrations` applied and nothing
 * else, fixture dataset loaded — and resets it when it doesn't (or when
 * SF2G_DB_RESET=1). Then refreshes every materialized view and precomputes
 * group rides so view-backed code paths have data.
 *
 * The local stack is shared by every checkout and worktree of this repo, so
 * the migration check matters: another branch's migrations leave extra
 * columns and RPCs behind that show up as snapshot diffs.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_SUPABASE } from "./local-supabase";
import {
  describeDrift,
  hasDrift,
  migrationDrift,
  parseMigrationList,
} from "./migration-drift";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

/**
 * Why the database needs a reset, or null when it matches this checkout.
 * Checks migrations first (cheaper to explain than a snapshot diff), then
 * the fixture row counts.
 */
async function resetReason(): Promise<string | null> {
  if (process.env.SF2G_DB_RESET === "1") return "SF2G_DB_RESET=1";

  let listed: string | null = null;
  try {
    listed = execSync("supabase migration list --local --output-format json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // No CLI on PATH, or the list failed: fall through to the fixture check.
  }
  const entries = listed === null ? null : parseMigrationList(listed);
  if (entries === null) {
    console.warn(
      "[db-setup] could not list local migrations; skipping the migration check",
    );
  } else {
    const drift = migrationDrift(entries);
    if (hasDrift(drift)) {
      return `local migrations differ from supabase/migrations (${describeDrift(drift)})`;
    }
  }

  if (!(await fixtureLoaded())) return "fixture dataset is not loaded";
  return null;
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

  const reason = await resetReason();
  if (reason !== null) {
    console.log(
      `[db-setup] ${reason}; resetting local database with fixtures…`,
    );
    execSync("supabase db reset", { cwd: ROOT, stdio: "inherit" });
  }

  process.env.SUPABASE_URL = LOCAL_SUPABASE.url;
  process.env.SUPABASE_ANON_KEY = LOCAL_SUPABASE.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SUPABASE.serviceRoleKey;

  const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
  const { MATERIALIZED_VIEW_REFRESHES } = await import("../server/cron");
  for (const fn of MATERIALIZED_VIEW_REFRESHES) {
    const { error } = await db.rpc(fn as never);
    if (error) throw new Error(`${fn}: ${error.message}`);
  }

  const { computeAndStoreGroupRides } = await import("../server/group-rides");
  await computeAndStoreGroupRides();
}
