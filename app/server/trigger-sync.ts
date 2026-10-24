/**
 * Client-callable server function to trigger a ride sync.
 *
 * This file ONLY exports createServerFn functions — no raw interfaces or
 * non-serverFn exports. This is required because TanStack Start's
 * import-protection plugin can tree-shake createServerFn exports but NOT
 * regular exports. If sync.ts (which has `performSync`, `SyncResult`) is
 * imported directly from a route component, the bundler follows the full
 * import graph into session.ts → @tanstack/react-start/server, which is
 * banned in client environments.
 *
 * Route components should import from this file.
 * Server-only code (cron.ts) should import directly from sync.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { getSessionData } from "../lib/session";
import { createAnonClient, createServiceClient } from "../lib/supabase";
import { backfillStep, performSync, type SyncOptions } from "./sync";

/**
 * Manual syncs do one Strava page inline (enough for any rider who rides
 * less than 100 times between syncs) and queue the rest for the sync queue
 * drain, so a request never exceeds the Worker's subrequest limit. Group
 * rides are recomputed by the queued view refresh, not per request.
 */
const MANUAL_SYNC_OPTIONS: SyncOptions = {
  maxPages: 1,
  perPage: 100,
  skipGroupRides: true,
  skipSameDayRecheck: true,
};

async function enqueue(
  kind: string,
  userId?: string,
  cursor?: { before: number },
) {
  const { error } = await createServiceClient().rpc("enqueue_sync_job", {
    p_kind: kind,
    ...(userId ? { p_user_id: userId } : {}),
    ...(cursor ? { p_cursor: cursor } : {}),
  });
  if (error)
    console.error(`[trigger-sync] enqueue ${kind} failed: ${error.message}`);
}

/** Maximum number of simultaneous syncs allowed globally. */
const MAX_CONCURRENT_SYNCS = 5;

/** Minimum time between syncs per user (in milliseconds). */
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Shared pre-sync validation: auth, cooldown, and concurrency checks.
 * Returns the authenticated userId on success, throws on failure.
 */
async function validateSyncPrereqs(): Promise<string> {
  const session = await getSessionData();
  if (!session) {
    throw new Error("Not authenticated");
  }

  // Check sync cooldown (5 minutes)
  const supabase = createAnonClient();
  const { data: user } = await supabase
    .from("users")
    .select("last_sync_at")
    .eq("id", session.userId)
    .single();

  if (user?.last_sync_at) {
    const lastSync = new Date(user.last_sync_at);
    const elapsed = Date.now() - lastSync.getTime();
    if (elapsed < SYNC_COOLDOWN_MS) {
      const remainingMinutes = Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 60_000);
      throw new Error(
        `SYNC_COOLDOWN:Please wait ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""} before syncing again.`,
      );
    }
  }

  // Check global sync concurrency (max 5 simultaneous syncs)
  // Heuristic: users who synced within the last 3 minutes are likely still active
  const serviceClient = createServiceClient();
  const { count: activeCount } = await serviceClient
    .from("users")
    .select("id", { count: "exact", head: true })
    .not("last_sync_at", "is", null)
    .gte("last_sync_at", new Date(Date.now() - 3 * 60 * 1000).toISOString());

  if ((activeCount ?? 0) >= MAX_CONCURRENT_SYNCS) {
    throw new Error(
      "SYNC_BUSY:Too many syncs in progress. Try again in a minute.",
    );
  }

  return session.userId;
}

/**
 * Trigger a ride sync for the currently authenticated user.
 *
 * Safety checks:
 * 1. Per-user cooldown — 5 minutes between syncs
 * 2. Global concurrency — max 5 simultaneous syncs
 *
 * Returns the sync result with counts of new rides, total processed, and errors.
 */
export const triggerSync = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await validateSyncPrereqs();
    try {
      const result = await performSync(userId, MANUAL_SYNC_OPTIONS);
      if (result.hasMore) await enqueue("incremental", userId);
      if (result.newRides > 0) await enqueue("refresh_views");
      return result;
    } catch (error) {
      console.error("[trigger-sync] performSync crashed:", error);
      return {
        newRides: 0,
        totalProcessed: 0,
        errors: [
          `Sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        hasMore: false,
        rateLimited: false,
      };
    }
  },
);

/**
 * Trigger a FULL re-sync for the currently authenticated user.
 *
 * Ignores `last_activity_at` so that all rides are re-fetched from Strava.
 * This updates watts/HR/calories data for historical rides. Ride overrides
 * are re-applied after upsert, so manual adjustments are preserved.
 *
 * Same safety checks as triggerSync (cooldown + concurrency).
 */
export const triggerFullResync = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await validateSyncPrereqs();
    try {
      // Re-fetch the newest page now; the queue pages back through the rest.
      const step = await backfillStep(
        userId,
        Math.floor(Date.now() / 1000),
        100,
      );
      if (step.nextBefore !== null) {
        await enqueue("backfill", userId, { before: step.nextBefore });
      }
      await enqueue("refresh_views");
      return {
        newRides: step.upserted,
        totalProcessed: step.upserted,
        errors: [],
        hasMore: step.nextBefore !== null,
        rateLimited: false,
      };
    } catch (error) {
      console.error("[trigger-sync] performSync (full resync) crashed:", error);
      return {
        newRides: 0,
        totalProcessed: 0,
        errors: [
          `Re-sync failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        ],
        hasMore: false,
        rateLimited: false,
      };
    }
  },
);
