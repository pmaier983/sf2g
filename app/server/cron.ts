/**
 * Cron jobs.
 *
 * Three independent tasks, each sized to fit one Cloudflare Workers Free
 * invocation (50 subrequests, 10 ms CPU):
 *
 * 1. `syncUserBatch` — sync the next few riders who haven't been synced in
 *    RESYNC_AFTER_MS, stopping before the subrequest budget runs out. Callers
 *    repeat until `remaining` is 0.
 * 2. `runMaintenance` — refresh the materialized views once after a sync pass.
 * 3. `runGroupRides` — recompute group rides from the co-occurrence view.
 *
 * Full reclassification is NOT part of cron: it loads every ride into the
 * Worker. New rides are classified on insert; DevTools has a manual button.
 *
 * Triggered by:
 * - POST /api/cron?task=sync|maintenance|groups (Bearer CRON_SECRET), called by
 *   .github/workflows/cron.yml
 * - The DevTools "Run Cron Jobs" button (admin-gated `triggerCronJobs`)
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceClient } from "../lib/supabase";
import { assertAdmin } from "../lib/admin";
import { CRON_SYNC_BUDGET } from "../lib/constants";
import { trackSubrequests } from "../lib/perf";
import { performSync, type SyncOptions, type SyncResult } from "./sync";
import { computeAndStoreGroupRides } from "./group-rides";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserSyncOutcome = "synced" | "partial" | "failed" | "needs_reauth";

export interface UserSyncResult {
  userId: string;
  displayName: string | null;
  outcome: UserSyncOutcome;
  newRides: number;
  error: string | null;
}

export type BatchStopReason =
  | "done"
  | "subrequest_budget"
  | "user_cap"
  | "time_budget"
  | "rate_limited";

export interface SyncBatchResult {
  /** Riders due for a sync when the batch started. */
  eligible: number;
  /** Riders still due after this batch (includes partially caught-up ones). */
  remaining: number;
  synced: number;
  partial: number;
  failed: number;
  needsReauth: number;
  rateLimited: boolean;
  stopReason: BatchStopReason;
  results: UserSyncResult[];
  durationMs: number;
}

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

export interface CronResult {
  sync: SyncBatchResult;
  maintenance: MaintenanceResult;
  groups: GroupRidesResult;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Sync batch
// ---------------------------------------------------------------------------

/** Options every cron-mode sync uses: one page, no per-user side work. */
export const CRON_SYNC_OPTIONS: SyncOptions = {
  skipLeaderboardRefresh: true,
  skipGroupRides: true,
  skipSameDayRecheck: true,
  maxPages: 1,
  perPage: CRON_SYNC_BUDGET.PER_PAGE,
  clearSessionOnReauth: false,
};

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface SyncBatchDeps {
  supabase: ServiceClient;
  sync: (userId: string, options: SyncOptions) => Promise<SyncResult>;
  /** Subrequests used so far in this invocation. */
  subrequests: () => number;
  now: () => number;
}

interface DueUser {
  id: string;
  display_name: string | null;
  consecutive_sync_failures: number;
  last_sync_error: string | null;
}

/** How many riders to look at per batch (more than any batch can process). */
const DUE_USER_LOOKAHEAD = 20;

function isReauthError(message: string): boolean {
  return (
    message.includes("REAUTH_REQUIRED") ||
    message.includes("token refresh failed") ||
    message.includes("Authorization Error")
  );
}

export async function syncUserBatch(
  deps: SyncBatchDeps,
): Promise<SyncBatchResult> {
  const { supabase, sync, subrequests, now } = deps;
  const startedAt = now();
  const cutoff = new Date(startedAt - CRON_SYNC_BUDGET.RESYNC_AFTER_MS);

  // Riders with a working connection who are due: never synced, synced before
  // the cutoff, or mid-catch-up (performSync leaves last_sync_at untouched
  // while more pages remain). Least recently synced first.
  const {
    data: due,
    count,
    error,
  } = await supabase
    .from("users")
    .select("id, display_name, consecutive_sync_failures, last_sync_error", {
      count: "exact",
    })
    .neq("strava_refresh_token", "")
    .ilike("strava_scopes", "%activity:read_all%")
    .is("deauthorized_at", null)
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff.toISOString()}`)
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(DUE_USER_LOOKAHEAD);

  if (error) {
    throw new Error(`Failed to load due users: ${error.message}`);
  }

  const users = (due ?? []) as DueUser[];
  const eligible = count ?? users.length;
  const results: UserSyncResult[] = [];
  let stopReason: BatchStopReason = "done";
  let rateLimited = false;

  for (const user of users) {
    if (results.length >= CRON_SYNC_BUDGET.MAX_USERS_PER_RUN) {
      stopReason = "user_cap";
      break;
    }
    if (
      subrequests() + CRON_SYNC_BUDGET.WORST_CASE_SUBREQUESTS_PER_USER >
      CRON_SYNC_BUDGET.SUBREQUEST_BUDGET
    ) {
      stopReason = "subrequest_budget";
      break;
    }
    if (now() - startedAt >= CRON_SYNC_BUDGET.MAX_TOTAL_DURATION_MS) {
      stopReason = "time_budget";
      break;
    }

    const name = user.display_name ?? user.id;
    try {
      const res = await sync(user.id, CRON_SYNC_OPTIONS);
      const outcome: UserSyncOutcome = res.hasMore ? "partial" : "synced";
      results.push({
        userId: user.id,
        displayName: user.display_name,
        outcome,
        newRides: res.newRides,
        error: null,
      });

      if (user.consecutive_sync_failures > 0 || user.last_sync_error) {
        await supabase
          .from("users")
          .update({ consecutive_sync_failures: 0, last_sync_error: null })
          .eq("id", user.id);
      }

      console.log(
        `[cron-sync] ${outcome === "partial" ? "⏩" : "✅"} ${name}: ${res.newRides} rides upserted`,
      );

      if (res.rateLimited) {
        rateLimited = true;
        stopReason = "rate_limited";
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reauth = isReauthError(message);
      results.push({
        userId: user.id,
        displayName: user.display_name,
        outcome: reauth ? "needs_reauth" : "failed",
        newRides: 0,
        error: message,
      });

      // Record the failure and move the rider to the back of the queue so
      // one broken account can't block everyone else.
      try {
        await supabase
          .from("users")
          .update({
            last_sync_at: new Date(now()).toISOString(),
            last_sync_error: message.slice(0, 500),
            consecutive_sync_failures: user.consecutive_sync_failures + 1,
          })
          .eq("id", user.id);
      } catch {
        // Best-effort — the batch result still reports the failure
      }

      console[reauth ? "warn" : "error"](
        `[cron-sync] ${reauth ? "⚠️ needs re-auth" : "❌"} ${name}: ${message}`,
      );

      if (message.includes("RATE_LIMITED")) {
        rateLimited = true;
        stopReason = "rate_limited";
        break;
      }
    }
  }

  const tally = (o: UserSyncOutcome) =>
    results.filter((r) => r.outcome === o).length;
  const synced = tally("synced");
  const partial = tally("partial");
  const failed = tally("failed");
  const needsReauth = tally("needs_reauth");

  // Fully synced and failed riders leave the due set; partial ones stay.
  const remaining = Math.max(0, eligible - synced - failed - needsReauth);

  return {
    eligible,
    remaining,
    synced,
    partial,
    failed,
    needsReauth,
    rateLimited,
    stopReason,
    results,
    durationMs: now() - startedAt,
  };
}

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
// All tasks (DevTools)
// ---------------------------------------------------------------------------

/** One sync batch, then maintenance, then group rides. */
export async function runCronJobs(): Promise<CronResult> {
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const { result: sync } = await trackSubrequests((subrequests) =>
    syncUserBatch({ supabase, sync: performSync, subrequests, now: Date.now }),
  );
  const maintenance = await runMaintenance(supabase);
  const groups = await runGroupRides();
  return {
    sync,
    maintenance,
    groups,
    totalDurationMs: Date.now() - startedAt,
  };
}

/**
 * Trigger all cron tasks from the DevTools panel. Admin only.
 */
export const triggerCronJobs = createServerFn({ method: "POST" }).handler(
  async (): Promise<CronResult> => {
    await assertAdmin();
    return runCronJobs();
  },
);
