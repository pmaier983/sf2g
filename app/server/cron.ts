/**
 * Scheduled work — maintenance helpers and the admin "run one tick" action.
 *
 * Rider syncing is a job queue (migration 041): the Strava webhook and a
 * daily sweep enqueue work, and the Cloudflare Cron Trigger (app/ssr.tsx
 * `scheduled`, every 5 minutes) drains it in budget-sized steps
 * (app/server/sync-drain.ts). This module keeps:
 *
 * - `runMaintenance` — refresh every materialized view once
 * - `runGroupRides` — recompute group rides in SQL
 * - `triggerCronJobs` — DevTools: run one queue tick now (admin only)
 *
 * Full reclassification is NOT scheduled: it loads every ride into the
 * Worker. New rides are classified on insert; DevTools has a manual button.
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceClient } from "../lib/supabase";
import { assertAdmin } from "../lib/admin";
import { computeAndStoreGroupRides } from "./group-rides";
import type { DrainResult } from "./sync-drain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenanceResult {
  refreshed: string[];
  errors: string[];
  durationMs: number;
}

export interface GroupRidesResult {
  ok: boolean;
  error: string | null;
  durationMs: number;
}

export interface CronResult extends DrainResult {
  durationMs: number;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

// ---------------------------------------------------------------------------
// Maintenance: materialized view refreshes
// ---------------------------------------------------------------------------

/** Every materialized view the app reads, refreshed once per sync pass. */
export const MATERIALIZED_VIEW_REFRESHES = [
  "refresh_leaderboard",
  "refresh_company_leaderboard",
  "refresh_route_speed_leaderboard",
  "refresh_ppr_dawn_rides",
  "refresh_ride_co_occurrences",
] as const;

export async function runMaintenance(
  supabase: ServiceClient = createServiceClient(),
): Promise<MaintenanceResult> {
  const startedAt = Date.now();
  const refreshed: string[] = [];
  const errors: string[] = [];

  for (const fn of MATERIALIZED_VIEW_REFRESHES) {
    const { error } = await supabase.rpc(fn as never);
    if (error) {
      errors.push(`${fn}: ${error.message}`);
      console.error(`[cron-maintenance] ${fn} failed: ${error.message}`);
    } else {
      refreshed.push(fn);
    }
  }

  return { refreshed, errors, durationMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Group rides
// ---------------------------------------------------------------------------

export async function runGroupRides(): Promise<GroupRidesResult> {
  const startedAt = Date.now();
  try {
    await computeAndStoreGroupRides();
    return { ok: true, error: null, durationMs: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron-groups] failed: ${message}`);
    return { ok: false, error: message, durationMs: Date.now() - startedAt };
  }
}

// ---------------------------------------------------------------------------
// DevTools
// ---------------------------------------------------------------------------

/**
 * Run one Cron Trigger tick now (queue due riders, drain within budget).
 * Admin only.
 */
export const triggerCronJobs = createServerFn({ method: "POST" }).handler(
  async (): Promise<CronResult> => {
    await assertAdmin();
    const startedAt = Date.now();
    const { runScheduledTick } = await import("./scheduled");
    const result = await runScheduledTick("devtools");
    return { ...result, durationMs: Date.now() - startedAt };
  },
);
