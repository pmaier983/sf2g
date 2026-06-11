/**
 * Strava webhook event processor.
 *
 * Handles incoming webhook events from Strava:
 * - activity.create — new activity uploaded → sync single ride
 * - activity.update — activity edited → re-sync single ride
 * - activity.delete — activity deleted → delete ride from DB
 * - athlete.update (authorized=false) — user revoked access → cleanup
 *
 * The webhook endpoint itself lives in app/routes/api/webhook.ts.
 * This module contains the processing logic.
 */
import { createServiceClient } from '../lib/supabase'
import { ensureValidToken } from '../lib/strava-oauth'
import { fetchSingleActivity, type StravaActivitySummary } from '../lib/strava'
import { classifyRoute } from '../lib/route-classifier'
import { classifyDestination } from '../lib/destination-classifier'
import { cleanupDeauthorizedUser } from './auth'
import type { RideInsert, RideUpdate, RouteCategory, UserUpdate } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strava webhook event payload */
export interface StravaWebhookEvent {
  /** 'activity' or 'athlete' */
  object_type: string
  /** 'create', 'update', or 'delete' */
  aspect_type: string
  /** Activity ID (for activity events) or athlete ID (for athlete events) */
  object_id: number
  /** Strava athlete ID of the event owner */
  owner_id: number
  /** Your webhook subscription ID */
  subscription_id: number
  /** Unix epoch timestamp of the event */
  event_time: number
  /** Changed fields (for updates) or {authorized: 'false'} for deauth */
  updates: Record<string, string>
}

export interface WebhookProcessResult {
  event_type: string
  action_taken: string
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Event Processor
// ---------------------------------------------------------------------------

/**
 * Process a Strava webhook event.
 *
 * Routes the event to the appropriate handler based on object_type and aspect_type.
 * All errors are caught and returned in the result — this function never throws.
 */
export async function processWebhookEvent(
  event: StravaWebhookEvent,
): Promise<WebhookProcessResult> {
  const eventType = `${event.object_type}.${event.aspect_type}`
  console.log(
    `[webhook] Processing event: ${eventType} | object_id=${event.object_id} owner_id=${event.owner_id}`,
  )

  try {
    // Route to appropriate handler
    if (event.object_type === 'activity') {
      if (event.aspect_type === 'create' || event.aspect_type === 'update') {
        return await handleActivityCreateOrUpdate(event)
      } else if (event.aspect_type === 'delete') {
        return await handleActivityDelete(event)
      }
    } else if (event.object_type === 'athlete' && event.aspect_type === 'update') {
      // Check for deauthorization
      if (event.updates?.authorized === 'false') {
        return await handleAthleteDeauth(event)
      }
      // Other athlete updates (profile changes) — no action needed
      return {
        event_type: eventType,
        action_taken: 'ignored_athlete_update',
        success: true,
      }
    }

    // Unknown event type — log and acknowledge
    console.warn(`[webhook] Unknown event type: ${eventType}`)
    return {
      event_type: eventType,
      action_taken: 'ignored_unknown',
      success: true,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[webhook] Error processing ${eventType}: ${errorMsg}`)
    return {
      event_type: eventType,
      action_taken: 'error',
      success: false,
      error: errorMsg,
    }
  }
}

// ---------------------------------------------------------------------------
// Activity Handlers
// ---------------------------------------------------------------------------

/**
 * Handle activity.create and activity.update events.
 *
 * Fetches the full activity from Strava, classifies it, and upserts into the DB.
 * The upsert with onConflict handles idempotency — safe to process the same event twice.
 */
async function handleActivityCreateOrUpdate(
  event: StravaWebhookEvent,
): Promise<WebhookProcessResult> {
  const eventType = `activity.${event.aspect_type}`
  const supabase = createServiceClient()

  // 1. Look up user by strava_id
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, display_name')
    .eq('strava_id', event.owner_id)
    .single()

  if (userError || !user) {
    console.warn(`[webhook] Unknown athlete ${event.owner_id} — ignoring`)
    return {
      event_type: eventType,
      action_taken: 'ignored_unknown_user',
      success: true,
    }
  }

  // 2. Get valid access token
  let accessToken: string
  try {
    accessToken = await ensureValidToken(user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[webhook] Token validation failed for ${user.display_name}: ${message}`)
    return {
      event_type: eventType,
      action_taken: 'token_error',
      success: false,
      error: `Token validation failed: ${message}`,
    }
  }

  // 3. Fetch full activity from Strava
  const { activity } = await fetchSingleActivity(accessToken, event.object_id)

  // 4. Filter: only process Rides (non-manual)
  if (activity.type !== 'Ride' || activity.manual) {
    console.log(
      `[webhook] Skipping non-ride activity: ${activity.type}${activity.manual ? ' (manual)' : ''}`,
    )
    return {
      event_type: eventType,
      action_taken: 'skipped_non_ride',
      success: true,
    }
  }

  // 5. Classify and transform
  const rideInsert = activityToRideInsert(user.id, activity)

  // 6. Upsert into database
  const { error: upsertError } = await supabase
    .from('rides')
    .upsert(rideInsert, { onConflict: 'strava_activity_id' })

  if (upsertError) {
    console.error(`[webhook] Upsert failed for activity ${event.object_id}:`, upsertError.message)
    return {
      event_type: eventType,
      action_taken: 'upsert_error',
      success: false,
      error: upsertError.message,
    }
  }

  // 7. Re-apply ride overrides if any exist for this user
  try {
    const { data: overrides } = await supabase
      .from('ride_overrides')
      .select('ride_id, override_name, override_route_category, is_hidden, is_not_sf2g')
      .eq('user_id', user.id)

    if (overrides && overrides.length > 0) {
      // Find the ride we just upserted
      const { data: upsertedRide } = await supabase
        .from('rides')
        .select('id')
        .eq('strava_activity_id', event.object_id)
        .single()

      if (upsertedRide) {
        const override = overrides.find((o) => o.ride_id === upsertedRide.id)
        if (override) {
          const updateFields: RideUpdate = {}
          if (override.override_name !== null) {
            updateFields.name = override.override_name
          }
          if (override.is_not_sf2g) {
            updateFields.route_category = null
          } else if (override.override_route_category !== null) {
            updateFields.route_category = override.override_route_category as RouteCategory
          }
          if (override.is_hidden) {
            updateFields.is_hidden = true
          }
          if (Object.keys(updateFields).length > 0) {
            await supabase.from('rides').update(updateFields).eq('id', upsertedRide.id)
          }
        }
      }
    }
  } catch (err) {
    // Override re-application is non-critical
    console.warn(`[webhook] Override re-application failed (non-critical): ${err instanceof Error ? err.message : String(err)}`)
  }

  // 8. Update user's last_sync_at, last_activity_at, and reset failure counter
  const userUpdateFields: UserUpdate = {
    last_sync_at: new Date().toISOString(),
  }
  if (activity.start_date) {
    userUpdateFields.last_activity_at = activity.start_date
  }
  // Reset consecutive sync failures on successful webhook processing
  // Note: consecutive_sync_failures and last_sync_error are from migration 028
  // and may not be in generated types until `pnpm db:types` is run.
  ;(userUpdateFields as Record<string, unknown>).consecutive_sync_failures = 0
  ;(userUpdateFields as Record<string, unknown>).last_sync_error = null
  await supabase.from('users').update(userUpdateFields).eq('id', user.id)

  console.log(
    `[webhook] ✅ ${user.display_name}: Processed ${activity.name} (${rideInsert.route_category ?? 'other'})`,
  )

  return {
    event_type: eventType,
    action_taken: 'ride_upserted',
    success: true,
  }
}

/**
 * Handle activity.delete events.
 *
 * Deletes the ride from the database by strava_activity_id.
 */
async function handleActivityDelete(
  event: StravaWebhookEvent,
): Promise<WebhookProcessResult> {
  const supabase = createServiceClient()

  const { error, count } = await supabase
    .from('rides')
    .delete({ count: 'exact' })
    .eq('strava_activity_id', event.object_id)

  if (error) {
    console.error(`[webhook] Delete failed for activity ${event.object_id}:`, error.message)
    return {
      event_type: 'activity.delete',
      action_taken: 'delete_error',
      success: false,
      error: error.message,
    }
  }

  console.log(`[webhook] 🗑️ Deleted ${count ?? 0} ride(s) for activity ${event.object_id}`)

  return {
    event_type: 'activity.delete',
    action_taken: count ? 'ride_deleted' : 'ride_not_found',
    success: true,
  }
}

// ---------------------------------------------------------------------------
// Athlete Handlers
// ---------------------------------------------------------------------------

/**
 * Handle athlete deauthorization events.
 *
 * When a user revokes access from Strava's settings, Strava sends a webhook
 * event with object_type='athlete' and updates.authorized='false'.
 *
 * Per Strava API compliance, we must:
 * 1. Clear stored tokens
 * 2. Delete all synced ride data
 * 3. Update leaderboard
 */
async function handleAthleteDeauth(
  event: StravaWebhookEvent,
): Promise<WebhookProcessResult> {
  const supabase = createServiceClient()

  // Look up user by strava_id (owner_id in the event)
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, display_name')
    .eq('strava_id', event.owner_id)
    .single()

  if (userError || !user) {
    console.warn(`[webhook] Deauth for unknown athlete ${event.owner_id} — ignoring`)
    return {
      event_type: 'athlete.deauth',
      action_taken: 'ignored_unknown_user',
      success: true,
    }
  }

  console.log(`[webhook] 🔒 Processing deauthorization for ${user.display_name}`)

  // Reuse the same cleanup logic as user-initiated disconnect
  // Token is already revoked by Strava — no need to call revokeToken()
  const { deletedRides } = await cleanupDeauthorizedUser(user.id)

  // Mark as deauthorized so cron doesn't keep trying to sync
  // Note: deauthorized_at is from migration 028 — may not be in generated types
  await supabase.from('users').update({
    deauthorized_at: new Date().toISOString(),
  } as UserUpdate).eq('id', user.id)

  console.log(`[webhook] ✅ Deauthorized ${user.display_name}: ${deletedRides} rides deleted`)

  return {
    event_type: 'athlete.deauth',
    action_taken: 'user_deauthorized',
    success: true,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transform a Strava activity summary into a RideInsert object.
 *
 * Note: This duplicates the logic from sync.ts to avoid circular imports.
 * sync.ts imports from auth.ts (via clearSessionData), and webhook.ts
 * imports from auth.ts (via cleanupDeauthorizedUser). Importing from
 * sync.ts here would create a circular dependency.
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
  })

  const destination = classifyDestination({
    start_latlng: activity.start_latlng,
    end_latlng: activity.end_latlng,
    summary_polyline: activity.map?.summary_polyline,
  })

  return {
    user_id: userId,
    strava_activity_id: activity.id,
    name: activity.name,
    ride_date: activity.start_date_local.split('T')[0],
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
    average_watts: activity.average_watts ?? null,
    max_watts: activity.max_watts ?? null,
    has_power_meter: !!(activity.average_watts),
    kilojoules: activity.kilojoules ?? null,
    average_heartrate: activity.average_heartrate ?? null,
    max_heartrate: activity.max_heartrate ?? null,
    has_heartrate: !!(activity.has_heartrate),
    suffer_score: activity.suffer_score ?? null,
  }
}
