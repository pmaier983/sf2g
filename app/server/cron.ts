/**
 * Cron job server function.
 *
 * Runs periodic maintenance tasks:
 * 1. **Sync all users** — fetch new rides from Strava for every registered user
 * 2. Reclassify all rides (fixes stale classifications)
 * 3. Enrich missing wind data (fetches from Open-Meteo)
 * 4. Refresh materialized views and pre-compute group rides
 *
 * Rate limit budgets:
 * - Strava: Uses ~50% of the 15-min window (85 of 170 effective requests),
 *   leaving the other half for manual user syncs.
 * - Open-Meteo: Uses 200 of 10,000 daily calls, leaving plenty for manual
 *   wind enrichment triggers and future growth.
 *
 * Protected by CRON_SECRET — must match the secret set in environment variables.
 * Can be triggered via:
 * - The DevTools panel "Run Cron Jobs" button
 * - An external cron service hitting the /api/cron route with the correct secret
 *
 * TODO(security): Rate-limit this endpoint to prevent abuse.
 */
import { createServerFn } from "@tanstack/react-start";
import { createServiceClient } from "../lib/supabase";
import { CRON_SYNC_BUDGET } from "../lib/constants";
import { performReclassification, type ReclassifyResult } from "./reclassify";
import {
  enrichMissingWindData,
  type WindEnrichmentResult,
} from "./wind-enrichment";
import { performSync, type SyncResult } from "./sync";
import { computeAndStoreGroupRides } from "./group-rides";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSyncResult {
  userId: string;
  displayName: string | null;
  result: SyncResult | null;
  error: string | null;
  skipped: boolean;
}

export interface SyncAllUsersResult {
  totalUsers: number;
  synced: number;
  skipped: number;
  failed: number;
  results: UserSyncResult[];
  durationMs: number;
}

export interface CronResult {
  syncAll: SyncAllUsersResult;
  reclassify: ReclassifyResult;
  wind: WindEnrichmentResult;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Sync All Users
// ---------------------------------------------------------------------------

/**
 * Sync rides for all users with valid Strava tokens.
 *
 * Iterates through all registered users, refreshing tokens as needed and
 * fetching new activities from Strava. Respects rate limits by:
 * - Adding a delay between each user sync
 * - Tracking total API calls and stopping early if budget is exhausted
 * - Enforcing a max total duration to prevent runaway execution
 *
 * Errors are isolated per-user — one user's expired token won't stop others.
 */
async function syncAllUsers(): Promise<SyncAllUsersResult> {
  const startTime = Date.now();
  const supabase = createServiceClient();
  const results: UserSyncResult[] = [];

  // Fetch all users with valid Strava refresh tokens
  const { data: users, error: fetchError } = await supabase
    .from("users")
    .select("id, display_name, strava_refresh_token, last_sync_at")
    .neq("strava_refresh_token", "")
    .order("last_sync_at", { ascending: true, nullsFirst: true }); // Sync least-recently-synced first

  if (fetchError || !users) {
    console.error("[cron-sync] Failed to fetch users:", fetchError?.message);
    return {
      totalUsers: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      results: [],
      durationMs: Date.now() - startTime,
    };
  }

  console.log(
    `[cron-sync] Found ${users.length} users with valid Strava tokens`,
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let estimatedApiCalls = 0;

  for (const user of users) {
    // Check user-per-run budget (Cloudflare subrequest limit protection)
    // Users are ordered by last_sync_at, so least-recently-synced get priority.
    // Remaining users will be picked up in the next cron run.
    if (synced + failed >= CRON_SYNC_BUDGET.MAX_USERS_PER_RUN) {
      console.warn(
        `[cron-sync] User budget exhausted (${synced + failed}/${CRON_SYNC_BUDGET.MAX_USERS_PER_RUN} users processed), stopping with ${users.length - results.length} users remaining`,
      );
      for (let i = results.length; i < users.length; i++) {
        results.push({
          userId: users[i].id,
          displayName: users[i].display_name,
          result: null,
          error: null,
          skipped: true,
        });
        skipped++;
      }
      break;
    }

    // Check time budget
    const elapsed = Date.now() - startTime;
    if (elapsed >= CRON_SYNC_BUDGET.MAX_TOTAL_DURATION_MS) {
      console.warn(
        `[cron-sync] Time budget exhausted (${Math.round(elapsed / 1000)}s), stopping with ${users.length - results.length} users remaining`,
      );
      // Mark remaining users as skipped
      for (let i = results.length; i < users.length; i++) {
        results.push({
          userId: users[i].id,
          displayName: users[i].display_name,
          result: null,
          error: null,
          skipped: true,
        });
        skipped++;
      }
      break;
    }

    // Check Strava API budget (each sync uses ~1-3 API calls for incremental sync)
    if (estimatedApiCalls >= CRON_SYNC_BUDGET.MAX_STRAVA_REQUESTS) {
      console.warn(
        `[cron-sync] Strava API budget exhausted (${estimatedApiCalls}/${CRON_SYNC_BUDGET.MAX_STRAVA_REQUESTS} calls), stopping with ${users.length - results.length} users remaining`,
      );
      for (let i = results.length; i < users.length; i++) {
        results.push({
          userId: users[i].id,
          displayName: users[i].display_name,
          result: null,
          error: null,
          skipped: true,
        });
        skipped++;
      }
      break;
    }

    // Add delay between users to spread load
    if (results.length > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, CRON_SYNC_BUDGET.DELAY_BETWEEN_USERS_MS),
      );
    }

    console.log(
      `[cron-sync] Syncing user ${user.display_name ?? user.id} (${results.length + 1}/${users.length})`,
    );

    try {
      const syncResult = await performSync(user.id, {
        // Skip per-user wind enrichment and leaderboard refresh in cron mode.
        // These run as separate cron steps (reclassify + wind), which is more
        // efficient and avoids blowing through Cloudflare's subrequest limit.
        skipWindEnrichment: true,
        skipLeaderboardRefresh: true,
      });

      results.push({
        userId: user.id,
        displayName: user.display_name,
        result: syncResult,
        error: null,
        skipped: false,
      });

      synced++;
      // Estimate API calls: 1 base + 1 per page (most incremental syncs are 1 page)
      estimatedApiCalls += Math.max(
        1,
        Math.ceil(syncResult.totalProcessed / 200),
      );

      console.log(
        `[cron-sync] ✅ ${user.display_name ?? user.id}: ${syncResult.newRides} new rides (${syncResult.totalProcessed} processed)`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      results.push({
        userId: user.id,
        displayName: user.display_name,
        result: null,
        error: errorMsg,
        skipped: false,
      });

      failed++;
      // Even failed syncs cost API calls (at least the token refresh attempt)
      estimatedApiCalls += 1;

      // Update last_sync_at even on failure so this user doesn't permanently
      // block the front of the queue. They'll rotate back naturally.
      try {
        await supabase
          .from("users")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", user.id);
      } catch {
        // Best-effort — don't fail the whole cron if this update fails
      }

      // Don't log full stack for expected errors (expired tokens, etc.)
      if (
        errorMsg.includes("REAUTH_REQUIRED") ||
        errorMsg.includes("token refresh failed")
      ) {
        console.warn(
          `[cron-sync] ⚠️ ${user.display_name ?? user.id}: Needs re-auth (skipping)`,
        );
      } else {
        console.error(
          `[cron-sync] ❌ ${user.display_name ?? user.id}: ${errorMsg}`,
        );
      }
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[cron-sync] Complete: ${synced} synced, ${failed} failed, ${skipped} skipped in ${Math.round(durationMs / 1000)}s (est. ${estimatedApiCalls} Strava API calls)`,
  );

  return {
    totalUsers: users.length,
    synced,
    skipped,
    failed,
    results,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Server Function (auth-gated, for DevTools panel)
// ---------------------------------------------------------------------------

/**
 * Trigger all cron jobs manually from the DevTools panel.
 * Requires an authenticated session (same as other DevTools actions).
 */
export const triggerCronJobs = createServerFn({ method: "POST" }).handler(
  async (): Promise<CronResult> => {
    return runCronJobs();
  },
);

// ---------------------------------------------------------------------------
// Core Logic (exported for the API route)
// ---------------------------------------------------------------------------

/**
 * Run all cron maintenance tasks sequentially.
 *
 * Order matters:
 * 1. Sync all users (produces new rides)
 * 2. Reclassify rides (fixes classifications on new + old rides)
 * 3. Wind enrichment (fetches weather data for new rides)
 */
export async function runCronJobs(): Promise<CronResult> {
  const startTime = Date.now();

  console.log("[cron] Starting cron jobs...");

  // 1. Sync all users (fetch new rides from Strava)
  console.log("[cron] Running sync for all users...");
  const syncAllResult = await syncAllUsers();
  console.log(
    `[cron] Sync complete: ${syncAllResult.synced} users synced, ${syncAllResult.failed} failed in ${Math.round(syncAllResult.durationMs / 1000)}s`,
  );

  // 2. Reclassify all rides (may fail on free plan if subrequests exhausted)
  let reclassifyResult: ReclassifyResult;
  try {
    console.log("[cron] Running reclassification...");
    reclassifyResult = await performReclassification();
    console.log(
      `[cron] Reclassification complete: ${reclassifyResult.updated} updated in ${reclassifyResult.durationMs}ms`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cron] Reclassification failed (may be subrequest limit): ${msg}`,
    );
    reclassifyResult = {
      totalRides: 0,
      updated: 0,
      routeChanges: 0,
      destinationChanges: 0,
      skippedOverrides: 0,
      errors: [`Skipped: ${msg}`],
      breakdown: {},
      durationMs: 0,
    };
  }

  // 3. Enrich missing wind data (may fail on free plan if subrequests exhausted)
  let windResult: WindEnrichmentResult;
  try {
    console.log("[cron] Running wind enrichment...");
    windResult = await enrichMissingWindData();
    console.log(
      `[cron] Wind enrichment complete: ${windResult.processed} processed in ${windResult.durationMs}ms`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cron] Wind enrichment failed (may be subrequest limit): ${msg}`,
    );
    windResult = {
      processed: 0,
      totalMissing: 0,
      errors: [`Skipped: ${msg}`],
      durationMs: 0,
    };
  }

  // 4. Refresh ride co-occurrences MV for the rider network
  //    Runs after sync + reclassify so new rides are included.
  //    Non-concurrent refresh (no unique index), but fast for small rider pools.
  try {
    console.log("[cron] Refreshing ride co-occurrences MV...");
    const coOccStart = Date.now();
    const supabase = createServiceClient();
    await supabase.rpc("refresh_ride_co_occurrences" as never);
    console.log(
      `[cron] Ride co-occurrences refresh complete in ${Date.now() - coOccStart}ms`,
    );

    // Pre-compute group rides from the refreshed MV
    console.log("[cron] Computing and storing group rides...");
    const groupStart = Date.now();
    await computeAndStoreGroupRides();
    console.log(
      `[cron] Group rides computation complete in ${Date.now() - groupStart}ms`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cron] Ride co-occurrences / group rides failed (non-critical): ${msg}`,
    );
  }

  // 5. Refresh PPR dawn rides MV so the PPR @ 6am filter includes new rides
  try {
    console.log("[cron] Refreshing PPR dawn rides MV...");
    const pprStart = Date.now();
    const supabase = createServiceClient();
    await supabase.rpc("refresh_ppr_dawn_rides" as never);
    console.log(
      `[cron] PPR dawn rides refresh complete in ${Date.now() - pprStart}ms`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cron] PPR dawn rides refresh failed (non-critical): ${msg}`);
  }

  const totalDurationMs = Date.now() - startTime;
  console.log(
    `[cron] All cron jobs complete in ${Math.round(totalDurationMs / 1000)}s`,
  );

  return {
    syncAll: syncAllResult,
    reclassify: reclassifyResult,
    wind: windResult,
    totalDurationMs,
  };
}
