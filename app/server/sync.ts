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
import { enrichMissingWindData } from "./wind-enrichment";
import { computeAndStoreGroupRides } from "./group-rides";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  newRides: number;
  totalProcessed: number;
  errors: string[];
}

/** Options to control sync behavior (used by cron to reduce subrequests) */
export interface SyncOptions {
  /** Skip per-user wind enrichment (cron runs it as a separate step) */
  skipWindEnrichment?: boolean;
  /** Skip per-user leaderboard refresh (cron's reclassify step handles it) */
  skipLeaderboardRefresh?: boolean;
  /** Ignore last_activity_at and re-fetch all rides from Strava */
  fullResync?: boolean;
}

// ---------------------------------------------------------------------------
// Core Sync Logic
// ---------------------------------------------------------------------------

/** Batch size for upsert operations */
const BATCH_SIZE = 100;

/** Max activities per page from Strava */
const PAGE_SIZE = 200;

/**
 * Transform a Strava activity summary into a RideInsert object.
 */
function activityToRideInsert(
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
      // Clear the session so the user has to re-login
      await clearSessionData();
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
      .select("*")
      .eq("id", userId)
      .single();

    lastActivityAt = userData?.last_activity_at
      ? Math.floor(new Date(userData.last_activity_at).getTime() / 1000)
      : undefined;
  }

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
        `[sync] Fetching Strava activities page ${page} (per_page=${PAGE_SIZE})`,
      );

      const { activities, response } = await fetchAthleteActivities(
        accessToken,
        {
          after: lastActivityAt,
          perPage: PAGE_SIZE,
          page,
        },
      );

      totalActivitiesFromStrava += activities.length;
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
      const rides = activities.filter((a) => a.type === "Ride" && !a.manual);

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

      // Check if we should stop paginating
      if (activities.length < PAGE_SIZE) {
        hasMore = false;
      } else if (response.__approachingRateLimit) {
        const msg = "Approaching Strava rate limit — stopping pagination early";
        console.warn(`[sync] ${msg}`);
        errors.push(msg);
        hasMore = false;
      } else {
        page++;
      }
    } catch (err) {
      const errMsg = `Failed to fetch page ${page}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[sync] ${errMsg}`);
      errors.push(errMsg);
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
  if (!stravaApiFailed && lastActivityAt !== undefined) {
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
        { after: todayEpoch, perPage: PAGE_SIZE, page: 1 },
      );

      const todayRides = todayActivities.filter(
        (a) => a.type === "Ride" && !a.manual,
      );

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
  try {
    // Get all ride IDs that were just upserted
    const upsertedRideIds = allRides.map((r) => r.strava_activity_id);

    if (upsertedRideIds.length > 0) {
      // Find any overrides for this user's rides
      const { data: overrides } = await supabase
        .from("ride_overrides")
        .select(
          "ride_id, override_name, override_route_category, is_hidden, is_not_sf2g",
        )
        .eq("user_id", userId);

      if (overrides && overrides.length > 0) {
        console.log(`[sync] Re-applying ${overrides.length} ride override(s)`);
        for (const override of overrides) {
          const updateFields: RideUpdate = {};

          if (override.override_name !== null) {
            updateFields.name = override.override_name;
          }
          if (override.is_not_sf2g) {
            updateFields.route_category = null;
          } else if (override.override_route_category !== null) {
            updateFields.route_category =
              override.override_route_category as RouteCategory;
          }
          if (override.is_hidden) {
            updateFields.is_hidden = true;
          }

          if (Object.keys(updateFields).length > 0) {
            await supabase
              .from("rides")
              .update(updateFields)
              .eq("id", override.ride_id);
          }
        }
      }
    }
  } catch (err) {
    // Override re-application is non-critical — don't fail the sync
    console.warn(
      `[sync] Override re-application failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 5. Update user sync metadata
  const latestActivityDate = allRides.reduce<string | null>((latest, ride) => {
    if (!latest || ride.start_date > latest) return ride.start_date;
    return latest;
  }, null);

  const updateFields: UserUpdate = {
    last_sync_at: new Date().toISOString(),
  };
  if (latestActivityDate) {
    updateFields.last_activity_at = latestActivityDate;
  }

  await supabase.from("users").update(updateFields).eq("id", userId);

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

  // Always refresh ride co-occurrences after sync so new riders appear in
  // group rides immediately — this must NOT be gated by skipLeaderboardRefresh
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

  // 7. Enrich wind data for newly synced rides (skipped in cron — runs as separate step)
  if (!options?.skipWindEnrichment) {
    try {
      const windResult = await enrichMissingWindData();
      console.log(
        `[sync] Wind enrichment: ${windResult.processed} rides enriched`,
      );
      if (windResult.errors.length > 0) {
        console.warn(
          `[sync] Wind enrichment errors: ${windResult.errors.join(" | ")}`,
        );
      }
    } catch (err) {
      // Wind enrichment is non-critical — don't fail the sync
      console.warn(
        `[sync] Wind enrichment failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const result: SyncResult = {
    newRides,
    totalProcessed: allRides.length,
    errors,
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
