/**
 * Ride sync pipeline.
 *
 * - `triggerSync` — server function that triggers a sync for the current user
 * - `performSync(userId)` — core sync logic: fetch, classify, upsert, refresh leaderboard
 */
import { createServiceClient } from "../lib/supabase";
import { ensureValidToken } from "../lib/strava-oauth";
import {
  fetchAthleteActivities,
  fetchSingleActivity,
  type StravaActivitySummary,
} from "../lib/strava";
import { classifyRoute } from "../lib/route-classifier";
import { classifyDestination } from "../lib/destination-classifier";
import { clearSessionData } from "../lib/session";
import type {
  RideInsert,
  RideUpdate,
  RouteCategory,
  UserUpdate,
} from "../lib/database.types";
import { computeAndStoreGroupRides } from "./group-rides";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  newRides: number;
  totalProcessed: number;
  errors: string[];
  /** A page came back full and pagination stopped early — call again to continue. */
  hasMore: boolean;
  /** Pagination stopped because Strava usage is near its limit. */
  rateLimited: boolean;
}

/** Options to control sync behavior (used by cron to reduce subrequests) */
export interface SyncOptions {
  /** Skip per-user materialized view refreshes (cron maintenance does them once) */
  skipLeaderboardRefresh?: boolean;
  /** Skip the co-occurrence refresh + group ride recompute (cron does it once) */
  skipGroupRides?: boolean;
  /** Skip the extra "re-check today's rides" Strava call */
  skipSameDayRecheck?: boolean;
  /** Max Strava pages per call (default MAX_PAGES_PER_SYNC) */
  maxPages?: number;
  /** Activities per Strava page (default PAGE_SIZE) */
  perPage?: number;
  /**
   * Clear the caller's session cookie when the token is dead. True for
   * interactive syncs; cron and webhooks have no rider session.
   */
  clearSessionOnReauth?: boolean;
  /** Ignore last_activity_at and re-fetch all rides from Strava */
  fullResync?: boolean;
}

/** True when Strava returned activities oldest-first (it does when `after` is set). */
export function isAscendingByStartDate(
  activities: Array<{ start_date: string }>,
): boolean {
  if (activities.length < 2) return true;
  return (
    activities[0].start_date <= activities[activities.length - 1].start_date
  );
}

// ---------------------------------------------------------------------------
// Core Sync Logic
// ---------------------------------------------------------------------------

/** Batch size for upsert operations */
const BATCH_SIZE = 100;

/** Max activities per page from Strava */
const PAGE_SIZE = 200;

/** Max pages to fetch per sync invocation (prevents Cloudflare subrequest exhaustion) */
const MAX_PAGES_PER_SYNC = 5;

/**
 * Transform a Strava activity summary into a RideInsert object.
 */
export function activityToRideInsert(
  userId: string,
  activity: StravaActivitySummary,
): RideInsert {
  const classification = classifyRoute({
    summary_polyline: activity.map?.summary_polyline,
    distance: activity.distance,
    total_elevation_gain: activity.total_elevation_gain,
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
  });

  const destination = classifyDestination({
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    summary_polyline: activity.map?.summary_polyline,
  });

  return {
    user_id: userId,
    strava_activity_id: activity.id,
    name: activity.name,
    ride_date: activity.start_date_local.split("T")[0], // YYYY-MM-DD
    start_date: activity.start_date,
    timezone: activity.timezone,
    route_category: classification.category,
    classification_confidence: classification.confidence,
    classification_method: classification.method,
    distance_meters: activity.distance,
    moving_time_seconds: activity.moving_time,
    elapsed_time_seconds: activity.elapsed_time,
    elevation_gain_meters: activity.total_elevation_gain,
    average_speed_mps: activity.average_speed,
    max_speed_mps: activity.max_speed,
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    summary_polyline: activity.map?.summary_polyline,
    is_commute: activity.commute ?? false,
    is_private: activity.private ?? false,
    destination_company: destination?.company ?? null,
    destination_office: destination?.officeName ?? null,
    destination_distance_meters: destination?.distanceMeters ?? null,
    // Power data (only present for riders with power meters)
    average_watts: activity.average_watts ?? null,
    max_watts: activity.max_watts ?? null,
    has_power_meter: !!activity.average_watts,
    kilojoules: activity.kilojoules ?? null,
    // Heart rate data (only present for riders with HR monitors)
    average_heartrate: activity.average_heartrate ?? null,
    max_heartrate: activity.max_heartrate ?? null,
    has_heartrate: !!activity.has_heartrate,
    suffer_score: activity.suffer_score ?? null,
    // Note: strava_raw column intentionally omitted — Strava API TOS prohibits
    // persistent caching of full raw API responses. The column is kept in the DB
    // for backward compat but no longer receives new data.
  };
}

/**
 * Perform a full sync for a user:
 * 1. Ensure valid token
 * 2. Paginate through Strava activities (incremental or initial)
 * 3. Filter to Rides (non-manual)
 * 4. Classify each ride
 * 5. Batch upsert into database
 * 6. Update user sync metadata
 * 7. Refresh leaderboard materialized view
 */
export async function performSync(
  userId: string,
  options?: SyncOptions,
): Promise<SyncResult> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  console.log(`[sync] Starting sync for user ${userId}`);

  // 1. Ensure valid access token (detect expired/revoked tokens)
  let accessToken: string;
  try {
    accessToken = await ensureValidToken(userId);
    console.log(`[sync] Got valid access token for user ${userId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[sync] Token validation failed for user ${userId}: ${message}`,
    );
    if (
      message.includes("token refresh failed") ||
      message.includes("Bad Request") ||
      message.includes("invalid") ||
      message.includes("Authorization Error")
    ) {
      // Clear the session so the user has to re-login (interactive syncs only)
      if (options?.clearSessionOnReauth !== false) {
        await clearSessionData();
      }
      throw new Error(
        "REAUTH_REQUIRED:Your Strava connection has expired. Please log in again.",
      );
    }
    throw err;
  }

  // 2. Read last_activity_at for incremental sync
  let lastActivityAt: number | undefined;
  if (options?.fullResync) {
    console.log("[sync] Full re-sync requested — fetching all rides");
    lastActivityAt = undefined;
  } else {
    const { data: userData } = await supabase
      .from("users")
      .select("last_activity_at")
      .eq("id", userId)
      .single();

    let lastActivityIso = userData?.last_activity_at ?? null;

    // A previous initial sync can die after upserting rides but before
    // writing last_activity_at. Without this, every later sync would restart
    // from the beginning of the athlete's history and die the same way.
    if (!lastActivityIso) {
      const { data: latestRide } = await supabase
        .from("rides")
        .select("start_date")
        .eq("user_id", userId)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestRide?.start_date) {
        lastActivityIso = latestRide.start_date;
        console.log(
          `[sync] last_activity_at missing — resuming after latest stored ride ${lastActivityIso}`,
        );
      }
    }

    lastActivityAt = lastActivityIso
      ? Math.floor(new Date(lastActivityIso).getTime() / 1000)
      : undefined;
  }

  const perPage = options?.perPage ?? PAGE_SIZE;
  const maxPages = options?.maxPages ?? MAX_PAGES_PER_SYNC;
  let hasMorePages = false;
  let rateLimited = false;
  /** Latest start_date across every fetched activity (rides or not). */
  let latestFetchedStart: string | null = null;

  console.log(
    `[sync] Incremental sync after: ${lastActivityAt ?? "none (full sync)"}`,
  );

  // 3. Paginate through Strava activities
  const allRides: RideInsert[] = [];
  let page = 1;
  let hasMore = true;

  let totalActivitiesFromStrava = 0;
  let totalFilteredOut = 0;
  let stravaApiFailed = false;

  while (hasMore) {
    try {
      console.log(
        `[sync] Fetching Strava activities page ${page} (per_page=${perPage})`,
      );

      const { activities, response } = await fetchAthleteActivities(
        accessToken,
        {
          after: lastActivityAt,
          perPage,
          page,
        },
      );

      totalActivitiesFromStrava += activities.length;
      for (const a of activities) {
        if (!latestFetchedStart || a.start_date > latestFetchedStart) {
          latestFetchedStart = a.start_date;
        }
      }
      console.log(
        `[sync] Page ${page}: Strava returned ${activities.length} activities`,
      );

      // Log all activity types for debugging
      if (activities.length > 0) {
        const typeCounts = new Map<string, number>();
        for (const a of activities) {
          const key = `${a.type}${a.manual ? " (manual)" : ""}`;
          typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
        }
        const typeBreakdown = Array.from(typeCounts.entries())
          .map(([type, count]) => `${type}=${count}`)
          .join(", ");
        console.log(`[sync] Activity types: ${typeBreakdown}`);
      }

      // Filter to rides only (non-manual)
      const rides = activities.filter(isSyncableActivity);

      const filtered = activities.length - rides.length;
      totalFilteredOut += filtered;
      if (filtered > 0) {
        console.log(
          `[sync] Filtered out ${filtered} non-ride/manual activities, keeping ${rides.length} rides`,
        );
      }

      // Transform and classify each ride
      for (const activity of rides) {
        try {
          const rideInsert = activityToRideInsert(userId, activity);
          allRides.push(rideInsert);
        } catch (err) {
          const errMsg = `Failed to process activity ${activity.id}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[sync] ${errMsg}`);
          errors.push(errMsg);
        }
      }

      if (
        lastActivityAt !== undefined &&
        activities.length === perPage &&
        !isAscendingByStartDate(activities)
      ) {
        // Continuation via last_activity_at assumes oldest-first pages.
        console.warn(
          "[sync] Strava returned a full page newest-first; continuation may skip activities",
        );
      }

      // Check if we should stop paginating
      if (activities.length < perPage) {
        hasMore = false;
      } else if (response.__approachingRateLimit) {
        const msg = "Approaching Strava rate limit — stopping pagination early";
        console.warn(`[sync] ${msg}`);
        errors.push(msg);
        hasMore = false;
        hasMorePages = true;
        rateLimited = true;
      } else {
        page++;
        // Safety valve: stop after maxPages to stay within Cloudflare subrequest limits
        if (page > maxPages) {
          if (maxPages === MAX_PAGES_PER_SYNC) {
            const msg = `Large history detected — synced first ${maxPages * perPage} activities. Click sync again for more.`;
            console.warn(`[sync] ${msg}`);
            errors.push(msg);
          }
          hasMore = false;
          hasMorePages = true;
        }
      }
    } catch (err) {
      const errMsg = `Failed to fetch page ${page}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[sync] ${errMsg}`);
      errors.push(errMsg);
      if (errMsg.includes("RATE_LIMITED")) rateLimited = true;
      stravaApiFailed = true;
      hasMore = false;
    }
  }

  console.log(
    `[sync] Fetch complete: ${totalActivitiesFromStrava} total activities from Strava, ${totalFilteredOut} filtered out, ${allRides.length} rides to upsert`,
  );

  // ---------------------------------------------------------------------------
  // Same-day ride update re-check
  // ---------------------------------------------------------------------------
  // When users edit a ride on Strava after syncing, the incremental sync won't
  // catch it because it uses `after` = `last_activity_at`. This secondary pass
  // re-fetches today's rides (1 extra API call) so any edited fields are picked
  // up via the onConflict upsert. Cost: 1 API call per sync — negligible.
  if (
    !stravaApiFailed &&
    lastActivityAt !== undefined &&
    !options?.skipSameDayRecheck
  ) {
    try {
      const todayEpoch = Math.floor(
        new Date(
          new Date().toISOString().split("T")[0] + "T00:00:00Z",
        ).getTime() / 1000,
      );
      console.log(
        `[sync] Re-checking today's rides (after epoch ${todayEpoch})`,
      );

      const { activities: todayActivities } = await fetchAthleteActivities(
        accessToken,
        { after: todayEpoch, perPage, page: 1 },
      );

      const todayRides = todayActivities.filter(isSyncableActivity);

      // Deduplicate: only process rides we didn't already fetch in the main pass
      const existingIds = new Set(allRides.map((r) => r.strava_activity_id));
      let sameDayUpdates = 0;

      for (const activity of todayRides) {
        try {
          const rideInsert = activityToRideInsert(userId, activity);
          if (existingIds.has(rideInsert.strava_activity_id)) {
            // Already in allRides from the incremental fetch — skip to avoid double-count
            continue;
          }
          allRides.push(rideInsert);
          sameDayUpdates++;
        } catch (err) {
          const errMsg = `Failed to process same-day activity ${activity.id}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[sync] ${errMsg}`);
          errors.push(errMsg);
        }
      }

      if (sameDayUpdates > 0) {
        console.log(
          `[sync] Same-day re-check found ${sameDayUpdates} additional/updated rides`,
        );
      }
    } catch (err) {
      // Same-day re-check is non-critical — don't fail the sync
      console.warn(
        `[sync] Same-day re-check failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // If the Strava API failed on the first page and we got 0 activities,
  // this is a total failure — throw so the caller knows sync didn't work
  if (stravaApiFailed && totalActivitiesFromStrava === 0) {
    const errMsg = errors.join("; ");
    console.error(
      `[sync] Strava API failed completely — no activities fetched: ${errMsg}`,
    );
    throw new Error(
      `SYNC_FAILED:Strava API error — your rides could not be fetched. This may be a temporary Strava outage. Details: ${errMsg}`,
    );
  }

  // 4. Batch upsert rides in groups of BATCH_SIZE
  let newRides = 0;

  for (let i = 0; i < allRides.length; i += BATCH_SIZE) {
    const batch = allRides.slice(i, i + BATCH_SIZE);
    console.log(
      `[sync] Upserting batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} rides)`,
    );

    const { error: upsertError, data: upsertedData } = await supabase
      .from("rides")
      .upsert(batch, { onConflict: "strava_activity_id" })
      .select("*");

    if (upsertError) {
      const errMsg = `Batch upsert error (offset ${i}): ${upsertError.message}`;
      console.error(`[sync] ${errMsg}`);
      errors.push(errMsg);
    } else {
      newRides += upsertedData?.length ?? 0;
      console.log(`[sync] Batch upserted ${upsertedData?.length ?? 0} rides`);
    }
  }

  // 4b. Re-apply ride overrides — user edits must survive syncs
  if (allRides.length > 0) {
    await reapplyOverrides(supabase, userId);
  }

  // 5. Update user sync metadata
  // Advance last_activity_at past every fetched activity (not just rides), so
  // a page of non-ride activities can't pin the cursor in place.
  const latestRideDate = allRides.reduce<string | null>((latest, ride) => {
    if (!latest || ride.start_date > latest) return ride.start_date;
    return latest;
  }, null);
  const latestActivityDate =
    [latestRideDate, latestFetchedStart]
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  const madeProgress =
    latestActivityDate !== null &&
    (lastActivityAt === undefined ||
      new Date(latestActivityDate).getTime() / 1000 > lastActivityAt);

  // last_sync_at means "caught up as of". While more pages remain (and we are
  // making progress) leave it alone so the cron batch picks this user again.
  const updateFields: UserUpdate = {};
  if (!hasMorePages || !madeProgress) {
    updateFields.last_sync_at = new Date().toISOString();
  }
  if (!stravaApiFailed) {
    updateFields.last_sync_success_at = new Date().toISOString();
    updateFields.needs_reauth = false;
  }
  if (latestActivityDate) {
    updateFields.last_activity_at = latestActivityDate;
  }

  if (Object.keys(updateFields).length > 0) {
    await supabase.from("users").update(updateFields).eq("id", userId);
  }

  // 6. Refresh leaderboard materialized view (skipped in cron — reclassify handles it)
  if (!options?.skipLeaderboardRefresh) {
    try {
      await supabase.rpc("refresh_leaderboard");
    } catch (err) {
      errors.push(
        `Failed to refresh leaderboard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Also refresh PPR dawn rides so PPR filter picks up new morning rides
    try {
      await supabase.rpc("refresh_ppr_dawn_rides" as never);
    } catch (err) {
      // Non-critical — PPR data will be refreshed in cron
      console.warn(
        `[sync] PPR dawn rides refresh failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Refresh ride co-occurrences after an interactive sync so new riders
  // appear in group rides immediately. Cron skips this per user (it costs
  // 10+ subrequests) and does it once in its maintenance step instead.
  if (!options?.skipGroupRides) {
    try {
      await supabase.rpc("refresh_ride_co_occurrences" as never);
      // Pre-compute group rides from the refreshed MV
      await computeAndStoreGroupRides();
    } catch (err) {
      // Non-critical — co-occurrences / group rides will be refreshed in cron
      console.warn(
        `[sync] Ride co-occurrences / group rides failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const result: SyncResult = {
    newRides,
    totalProcessed: allRides.length,
    errors,
    hasMore: hasMorePages,
    rateLimited,
  };

  console.log(
    `[sync] Sync complete for user ${userId}: ${newRides} new rides, ${allRides.length} total processed, ${errors.length} errors`,
  );
  if (errors.length > 0) {
    console.warn(`[sync] Sync errors: ${errors.join(" | ")}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// NOTE: The client-callable `triggerSync` server function lives in
// trigger-sync.ts to keep this module free of createServerFn exports.
// That separation lets route components import triggerSync without
// pulling in this file's server-only transitive dependencies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared helpers for queue jobs (sync-drain.ts)
// ---------------------------------------------------------------------------

/** Which Strava activities become rides. One rule for every sync path. */
export function isSyncableActivity(a: {
  type: string;
  manual?: boolean;
}): boolean {
  return a.type === "Ride" && !a.manual;
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Re-apply a rider's manual ride edits in one statement. */
export async function reapplyOverrides(
  supabase: ServiceClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc("reapply_ride_overrides", {
    p_user_id: userId,
  });
  if (error) {
    // Non-critical: the next sync re-applies them
    console.warn(`[sync] Override re-application failed: ${error.message}`);
  }
}

export type ActivityJobOutcome =
  | "ride_upserted"
  | "skipped_not_a_ride"
  | "not_found";

/**
 * Fetch one activity (webhook create/update) and upsert it.
 * ~5 subrequests: user read (+ token refresh when expired), Strava, upsert,
 * overrides, user update.
 */
export async function syncSingleActivity(
  userId: string,
  activityId: number,
): Promise<ActivityJobOutcome> {
  const supabase = createServiceClient();
  const accessToken = await ensureValidToken(userId);
  let activity: StravaActivitySummary;
  try {
    ({ activity } = await fetchSingleActivity(accessToken, activityId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Deleted or made private on Strava before we got to it
    if (msg.includes("(404)")) return "not_found";
    throw err;
  }
  if (!isSyncableActivity(activity)) return "skipped_not_a_ride";

  const ride = activityToRideInsert(userId, activity);
  const { error } = await supabase
    .from("rides")
    .upsert(ride, { onConflict: "strava_activity_id" });
  if (error) throw new Error(`Upsert failed: ${error.message}`);
  await reapplyOverrides(supabase, userId);

  const now = new Date().toISOString();
  await supabase
    .from("users")
    .update({
      last_sync_success_at: now,
      consecutive_sync_failures: 0,
      last_sync_error: null,
      needs_reauth: false,
    })
    .eq("id", userId);
  return "ride_upserted";
}

export interface BackfillStepResult {
  upserted: number;
  /** Cursor for the next page (epoch seconds), or null when history is done */
  nextBefore: number | null;
}

/**
 * Import one page of a rider's older history (activities before `before`,
 * newest first). Called repeatedly by backfill jobs until nextBefore is null.
 */
export async function backfillStep(
  userId: string,
  before: number,
  perPage: number,
): Promise<BackfillStepResult> {
  const supabase = createServiceClient();
  const accessToken = await ensureValidToken(userId);
  const { activities } = await fetchAthleteActivities(accessToken, {
    before,
    perPage,
    page: 1,
  });
  const rides = activities
    .filter(isSyncableActivity)
    .map((a) => activityToRideInsert(userId, a));
  for (let i = 0; i < rides.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from("rides")
      .upsert(rides.slice(i, i + BATCH_SIZE), {
        onConflict: "strava_activity_id",
      });
    if (error) throw new Error(`Backfill upsert failed: ${error.message}`);
  }
  if (rides.length > 0) await reapplyOverrides(supabase, userId);

  const oldest = activities.reduce<number | null>((min, a) => {
    const t = Math.floor(new Date(a.start_date).getTime() / 1000);
    return min === null || t < min ? t : min;
  }, null);
  const done =
    activities.length < perPage || oldest === null || oldest >= before;
  return { upserted: rides.length, nextBefore: done ? null : oldest };
}
