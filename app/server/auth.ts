/**
 * Auth server functions.
 *
 * - `getStravaAuthUrl` — returns Strava OAuth authorization URL
 * - `handleStravaCallback` — exchanges code, upserts user, sets session
 * - `getCurrentUser` — reads session, returns user from DB
 * - `logout` — clears session cookie
 */
import { createServerFn } from '@tanstack/react-start'
import { createAnonClient, createServiceClient } from '../lib/supabase'
import {
  getAuthorizationUrl,
  exchangeCode,
  revokeToken,
  ensureValidToken,
} from '../lib/strava-oauth'
import {
  getSessionData,
  setSessionData,
  clearSessionData,
} from '../lib/session'
import { getMissingScopes } from '../lib/constants'
import type { User } from '../lib/database.types'

// ---------------------------------------------------------------------------
// getStravaAuthUrl — returns the Strava OAuth authorize URL
// ---------------------------------------------------------------------------
export const getStravaAuthUrl = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getAuthorizationUrl()
  },
)

// ---------------------------------------------------------------------------
// handleStravaCallback — exchanges code for tokens, upserts user, sets session
// ---------------------------------------------------------------------------
export const handleStravaCallback = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: { code: string; scope: string; state: string }) => input,
  )
  .handler(async ({ data }) => {
    // 1. Exchange authorization code for tokens
    const tokenData = await exchangeCode(data.code)

    // 2. Validate that the user granted ALL required scopes
    //    Strava lets users uncheck permissions on the consent screen.
    //    If they uncheck "View data about your private activities", the API
    //    silently returns only public rides, causing empty syncs.
    const missingScopes = getMissingScopes(data.scope)
    if (missingScopes.length > 0) {
      console.error(
        `[auth] User denied required scopes: ${missingScopes.join(', ')}. Granted: ${data.scope}`,
      )
      throw new Error(
        `INSUFFICIENT_SCOPES:SF2G needs all permissions checked on the Strava authorization page to work correctly. ` +
        `Please try again and make sure all checkboxes are checked. ` +
        `(Missing: ${missingScopes.join(', ')})`,
      )
    }

    // 3. Upsert user in database (service role client bypasses RLS)
    const supabase = createServiceClient()
    const { data: user, error } = await supabase
      .from('users')
      .upsert(
        {
          strava_id: tokenData.athlete.id,
          username: tokenData.athlete.username,
          first_name: tokenData.athlete.firstname,
          last_name: tokenData.athlete.lastname,
          avatar_url: tokenData.athlete.profile,
          strava_access_token: tokenData.access_token,
          strava_refresh_token: tokenData.refresh_token,
          strava_token_expires_at: new Date(
            tokenData.expires_at * 1000,
          ).toISOString(),
          strava_scopes: data.scope,
        },
        { onConflict: 'strava_id' },
      )
      .select('*')
      .single()

    if (error || !user) {
      throw new Error(
        `Failed to upsert user: ${error?.message ?? 'unknown error'}`,
      )
    }

    // 4. Set session cookie
    await setSessionData({ userId: user.id, stravaId: user.strava_id })

    // 5. Trigger initial ride sync so the user sees their history immediately.
    //    With the webhook transition, the cron no longer polls Strava for rides.
    //    Webhooks only fire for future activities, not historical backfill.
    //    This sync runs inline so the callback page can show progress/results.
    //    Wind enrichment is skipped here — it queries ALL rides globally and
    //    makes hundreds of API calls, causing the callback to stall for 30+ seconds.
    //    Wind data is backfilled by the cron or manual sync.
    let syncResult: { newRides: number; totalProcessed: number; errors: string[] } | null = null
    let syncError: string | null = null

    try {
      const { performSync } = await import('./sync')
      console.log(`[auth] Triggering initial sync for user ${user.id} (${user.display_name ?? user.username ?? 'new user'})`)
      syncResult = await performSync(user.id, { skipWindEnrichment: true, isInitialSync: true })
      console.log(`[auth] Initial sync complete: ${syncResult.newRides} new rides, ${syncResult.totalProcessed} total`)
    } catch (err) {
      // Don't block auth on sync failure — the user can manually sync later.
      // But propagate rate limit errors so the callback page can show them.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[auth] Initial sync failed (non-blocking): ${message}`)
      syncError = message
    }

    // 6. Return redirect URL with sync result metadata
    return {
      redirectTo: '/leaderboard' as const,
      syncResult,
      syncError,
    }
  })

// ---------------------------------------------------------------------------
// getCurrentUser — reads session cookie and returns the user from DB
// ---------------------------------------------------------------------------
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<User | null> => {
    const session = await getSessionData()
    if (!session) return null

    const supabase = createAnonClient()
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.userId)
      .single()

    if (error || !user) return null

    return user
  },
)

// ---------------------------------------------------------------------------
// logout — clears session cookie and returns redirect
// ---------------------------------------------------------------------------
export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  await clearSessionData()
  return { redirectTo: '/' as const }
})

// ---------------------------------------------------------------------------
// cleanupDeauthorizedUser — shared cleanup for disconnect + webhook deauth
// ---------------------------------------------------------------------------

/**
 * Clean up a user's data after deauthorization.
 *
 * Called by both:
 * - User-initiated disconnect (`disconnectStrava`)
 * - Strava webhook deauth events (`handleAthleteDeauth` in webhook.ts)
 *
 * Does NOT revoke the Strava token — the caller handles that if needed.
 * Does NOT clear the session — the caller handles that if needed.
 */
export async function cleanupDeauthorizedUser(userId: string): Promise<{ deletedRides: number }> {
  const supabase = createServiceClient()

  // 1. Clear Strava tokens and sync timestamps from the database
  //    Resetting last_activity_at and last_sync_at ensures a clean initial
  //    sync if the user reconnects later (no stale 'after' parameter).
  const { error: updateError } = await supabase
    .from('users')
    .update({
      strava_access_token: '',
      strava_refresh_token: '',
      strava_token_expires_at: new Date(0).toISOString(),
      strava_scopes: '',
      last_activity_at: null,
      last_sync_at: null,
    })
    .eq('id', userId)

  if (updateError) {
    throw new Error(`Failed to clear Strava tokens: ${updateError.message}`)
  }

  // 2. Delete all user rides (Strava API compliance — data must be removed on disconnect)
  const { error: deleteError, count: deletedCount } = await supabase
    .from('rides')
    .delete({ count: 'exact' })
    .eq('user_id', userId)

  if (deleteError) {
    console.error(`[auth] Failed to delete rides for user ${userId}:`, deleteError.message)
    // Don't throw — continue with disconnect even if ride deletion fails
    // The user's tokens are already cleared, so they can't re-sync
  } else {
    console.log(`[auth] Deleted ${deletedCount ?? 0} rides for user ${userId}`)
  }

  // 3. Refresh leaderboard view to remove deleted user's data
  try {
    await supabase.rpc('refresh_leaderboard')
  } catch (err) {
    console.error('[auth] Failed to refresh leaderboard after ride deletion:', err)
  }

  return { deletedRides: deletedCount ?? 0 }
}

// ---------------------------------------------------------------------------
// disconnectStrava — revokes Strava access, cleans up data, clears session
// ---------------------------------------------------------------------------
export const disconnectStrava = createServerFn({ method: 'POST' }).handler(
  async () => {
    // 1. Verify the user is authenticated
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    // 2. Get a valid access token to revoke
    try {
      const accessToken = await ensureValidToken(session.userId)

      // 3. Revoke the token with Strava (best-effort — continue even if it fails)
      try {
        await revokeToken(accessToken)
      } catch (err) {
        // Log but don't block — the user still wants to disconnect locally
        console.error('Failed to revoke Strava token, continuing with local cleanup', err)
      }
    } catch (err) {
      // Token might already be invalid — continue with local cleanup
      console.error('Failed to get valid token for revocation, continuing with local cleanup', err)
    }

    // 4. Clean up user data (tokens, rides, leaderboard)
    await cleanupDeauthorizedUser(session.userId)

    // 5. Clear session cookie
    await clearSessionData()

    return { redirectTo: '/' as const }
  },
)
