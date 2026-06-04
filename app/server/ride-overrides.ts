/**
 * Ride override server functions.
 *
 * - `upsertRideOverride` — creates or updates a ride override (edit name, route, hide)
 * - `deleteRideOverride` — removes an override and reverts the ride to synced values
 */
import { createServerFn } from '@tanstack/react-start'
import { createServiceClient } from '../lib/supabase'
import { getSessionData } from '../lib/session'
import type { RouteCategory, RideUpdate } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Allowed route categories (allow-list for validation)
// ---------------------------------------------------------------------------
const VALID_ROUTES = new Set<string>([
  'bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other',
])

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// upsertRideOverride — create or update a ride override
// ---------------------------------------------------------------------------
export const upsertRideOverride = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    rideId: string
    overrideName?: string | null
    overrideRouteCategory?: string | null
    isHidden?: boolean
    isNotSf2g?: boolean
  }) => {
    // Validate rideId is UUID format
    if (!UUID_REGEX.test(input.rideId)) {
      throw new Error('Invalid ride ID')
    }
    // Validate route category if provided
    if (input.overrideRouteCategory && !VALID_ROUTES.has(input.overrideRouteCategory)) {
      throw new Error('Invalid route category')
    }
    // Validate name length if provided
    if (input.overrideName && input.overrideName.length > 200) {
      throw new Error('Name too long (max 200 chars)')
    }
    return input
  })
  .handler(async ({ data }) => {
    // 1. Get current user from session
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    const supabase = createServiceClient()

    // 2. Verify the ride belongs to this user
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id, name, route_category')
      .eq('id', data.rideId)
      .single()

    if (rideError || !ride) {
      throw new Error('Ride not found')
    }

    if (ride.user_id !== session.userId) {
      throw new Error('You can only edit your own rides')
    }

    // 3. Upsert the override
    const { error: overrideError } = await supabase
      .from('ride_overrides')
      .upsert(
        {
          ride_id: data.rideId,
          user_id: session.userId,
          override_name: data.overrideName ?? null,
          override_route_category: data.overrideRouteCategory ?? null,
          is_hidden: data.isHidden ?? false,
          is_not_sf2g: data.isNotSf2g ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'ride_id,user_id' },
      )

    if (overrideError) {
      console.error('[ride-overrides] Upsert error:', overrideError.message)
      throw new Error('Failed to save ride override')
    }

    // 4. Apply override to the ride itself (update rides table)
    const rideUpdate: RideUpdate = {}

    if (data.overrideName !== undefined) {
      rideUpdate.name = data.overrideName
    }

    if (data.isNotSf2g) {
      rideUpdate.route_category = null
    } else if (data.overrideRouteCategory !== undefined) {
      rideUpdate.route_category = data.overrideRouteCategory as RouteCategory
    }

    if (data.isHidden !== undefined) {
      rideUpdate.is_hidden = data.isHidden
    }

    if (Object.keys(rideUpdate).length > 0) {
      const { error: updateError } = await supabase
        .from('rides')
        .update(rideUpdate)
        .eq('id', data.rideId)

      if (updateError) {
        console.error('[ride-overrides] Ride update error:', updateError.message)
        throw new Error('Failed to apply ride override')
      }
    }

    // 5. Refresh leaderboard materialized view
    try {
      await supabase.rpc('refresh_leaderboard')
    } catch (err) {
      // Non-critical — log but don't fail the operation
      console.warn('[ride-overrides] Failed to refresh leaderboard:', err)
    }

    return { success: true }
  })

// ---------------------------------------------------------------------------
// deleteRideOverride — remove an override (revert to synced values)
// ---------------------------------------------------------------------------
export const deleteRideOverride = createServerFn({ method: 'POST' })
  .inputValidator((input: { rideId: string }) => {
    if (!UUID_REGEX.test(input.rideId)) {
      throw new Error('Invalid ride ID')
    }
    return input
  })
  .handler(async ({ data }) => {
    // 1. Get current user from session
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    const supabase = createServiceClient()

    // 2. Verify ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', data.rideId)
      .single()

    if (rideError || !ride) {
      throw new Error('Ride not found')
    }

    if (ride.user_id !== session.userId) {
      throw new Error('You can only edit your own rides')
    }

    // 3. Delete the override
    const { error: deleteError } = await supabase
      .from('ride_overrides')
      .delete()
      .eq('ride_id', data.rideId)
      .eq('user_id', session.userId)

    if (deleteError) {
      console.error('[ride-overrides] Delete error:', deleteError.message)
      throw new Error('Failed to delete ride override')
    }

    // 4. Revert ride — un-hide it (name/route will be corrected on next sync)
    const { error: revertError } = await supabase
      .from('rides')
      .update({ is_hidden: false })
      .eq('id', data.rideId)

    if (revertError) {
      console.warn('[ride-overrides] Revert error:', revertError.message)
    }

    // 5. Refresh leaderboard
    try {
      await supabase.rpc('refresh_leaderboard')
    } catch (err) {
      console.warn('[ride-overrides] Failed to refresh leaderboard:', err)
    }

    return { success: true }
  })
