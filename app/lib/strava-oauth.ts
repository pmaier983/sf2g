/**
 * Strava OAuth helpers.
 *
 * - `getAuthorizationUrl()` — builds the Strava authorize URL
 * - `exchangeCode(code)` — exchanges authorization code for tokens
 * - `refreshToken(refreshToken)` — refreshes an expired access token
 * - `ensureValidToken(userId)` — transparently refreshes if needed, returns a valid access token
 *
 * NO `Buffer` — uses `btoa`/`atob` for Cloudflare Workers compatibility.
 */

import { createServiceClient } from './supabase'
import {
  STRAVA_AUTHORIZE_URL,
  STRAVA_TOKEN_URL,
  STRAVA_REVOKE_URL,
  STRAVA_SCOPES,
} from './constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StravaTokenResponse {
  token_type: string
  expires_at: number
  expires_in: number
  refresh_token: string
  access_token: string
  athlete: {
    id: number
    username: string | null
    firstname: string | null
    lastname: string | null
    profile: string | null
    profile_medium: string | null
  }
}

export interface StravaRefreshResponse {
  token_type: string
  access_token: string
  expires_at: number
  expires_in: number
  refresh_token: string
}

// ---------------------------------------------------------------------------
// OAuth URL Builder
// ---------------------------------------------------------------------------

/**
 * Build the Strava OAuth authorization URL.
 * The user is redirected here to grant access.
 */
export function getAuthorizationUrl(): string {
  const clientId = process.env.STRAVA_CLIENT_ID
  const appUrl = process.env.APP_URL

  if (!clientId || !appUrl) {
    throw new Error('Missing STRAVA_CLIENT_ID or APP_URL environment variables')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/auth/callback`,
    response_type: 'code',
    scope: STRAVA_SCOPES,
    approval_prompt: 'auto',
    state: crypto.randomUUID(), // CSRF protection
  })

  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Token Exchange
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for access/refresh tokens.
 * Called during the OAuth callback flow.
 */
export async function exchangeCode(code: string): Promise<StravaTokenResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET environment variables')
  }

  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[strava-oauth] Token exchange failed:', response.status, errorText)
    throw new Error(
      `Strava token exchange failed (${response.status}): ${errorText}`,
    )
  }

  return (await response.json()) as StravaTokenResponse
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an expired Strava access token using the refresh token.
 */
export async function refreshToken(
  currentRefreshToken: string,
): Promise<StravaRefreshResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET environment variables')
  }

  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[strava-oauth] Token refresh failed:', response.status, errorText)
    throw new Error(
      `Strava token refresh failed (${response.status}): ${errorText}`,
    )
  }

  return (await response.json()) as StravaRefreshResponse
}

// ---------------------------------------------------------------------------
// Ensure Valid Token
// ---------------------------------------------------------------------------

/** 5-minute buffer before expiry to trigger refresh */
const TOKEN_BUFFER_MS = 5 * 60 * 1000

/**
 * Ensure the user has a valid (non-expired) Strava access token.
 *
 * If the current token is about to expire (within 5 minutes), refreshes it
 * and updates ALL token fields in the database (including the new refresh_token,
 * which Strava may rotate on each refresh).
 *
 * @param userId - The user's UUID
 * @returns A valid Strava access token
 */
export async function ensureValidToken(userId: string): Promise<string> {
  const supabase = createServiceClient()

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !user) {
    throw new Error(`User not found: ${userId}`)
  }

  // Check if the token is still valid (with 5-minute buffer)
  const expiresAt = new Date(user.strava_token_expires_at).getTime()
  const now = Date.now()

  if (now < expiresAt - TOKEN_BUFFER_MS) {
    return user.strava_access_token // Still valid
  }

  // Refresh the token
  const newTokens = await refreshToken(user.strava_refresh_token)

  // CRITICAL: Store the new refresh token — Strava may rotate it
  const { error: updateError } = await supabase
    .from('users')
    .update({
      strava_access_token: newTokens.access_token,
      strava_refresh_token: newTokens.refresh_token,
      strava_token_expires_at: new Date(
        newTokens.expires_at * 1000,
      ).toISOString(),
    })
    .eq('id', userId)

  if (updateError) {
    throw new Error(`Failed to update tokens for user ${userId}: ${updateError.message}`)
  }

  return newTokens.access_token
}

// ---------------------------------------------------------------------------
// Token Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke the user's Strava access by calling the new oauth/revoke endpoint.
 *
 * This fully disconnects the app from the athlete's Strava account.
 * After revocation, the access token and refresh token are no longer valid.
 *
 * @param accessToken - The user's current Strava access token
 * @throws Error if revocation fails
 */
export async function revokeToken(accessToken: string): Promise<void> {
  const response = await fetch(STRAVA_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[strava-oauth] Token revocation failed:', response.status, errorText)
    throw new Error(
      `Strava token revocation failed (${response.status}): ${errorText}`,
    )
  }
}
