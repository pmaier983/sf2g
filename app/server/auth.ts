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

    // 3. Set session cookie
    await setSessionData({ userId: user.id, stravaId: user.strava_id })

    // 4. Return redirect URL
    return { redirectTo: '/leaderboard' as const }
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
// disconnectStrava — revokes Strava access, clears tokens, clears session
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

    // 4. Clear Strava tokens from the database (service client bypasses RLS)
    const supabase = createServiceClient()
    const { error: updateError } = await supabase
      .from('users')
      .update({
        strava_access_token: '',
        strava_refresh_token: '',
        strava_token_expires_at: new Date(0).toISOString(),
        strava_scopes: '',
      })
      .eq('id', session.userId)

    if (updateError) {
      throw new Error(`Failed to clear Strava tokens: ${updateError.message}`)
    }

    // 5. Clear session cookie
    await clearSessionData()

    return { redirectTo: '/' as const }
  },
)
