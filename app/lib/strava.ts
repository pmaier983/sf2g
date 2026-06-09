/**
 * Strava API client helpers.
 *
 * All Strava API calls go through `fetchWithRateLimit()` to respect rate limits.
 *
 * - `fetchAthleteActivities(accessToken, params)` — paginated activity list
 */

import { STRAVA_API_BASE } from './constants'
import { fetchWithRateLimit, type RateLimitedResponse } from './rate-limiter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for fetching athlete activities */
export interface FetchActivitiesParams {
  /** Epoch timestamp — return only activities after this time */
  after?: number
  /** Number of activities per page (max 200) */
  perPage?: number
  /** Page number (1-indexed) */
  page?: number
}

/**
 * Strava activity summary from the list endpoint.
 * This is a simplified type — Strava returns many more fields.
 */
export interface StravaActivitySummary {
  id: number
  name: string
  type: string
  sport_type: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  start_date: string
  start_date_local: string
  timezone: string
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
  average_speed: number
  max_speed: number
  map: {
    id: string
    summary_polyline: string | null
    resource_state: number
  }
  commute: boolean
  manual: boolean
  private: boolean
  trainer: boolean
  // Power data (optional — only present if rider has a power meter)
  average_watts?: number
  max_watts?: number
  weighted_average_watts?: number
  kilojoules?: number
  // Heart rate data (optional — only present if rider has HR monitor)
  has_heartrate?: boolean
  average_heartrate?: number
  max_heartrate?: number
  suffer_score?: number
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

/**
 * Fetch athlete activities from Strava API.
 *
 * Uses `fetchWithRateLimit()` for automatic 429 retry and rate limit awareness.
 *
 * @param accessToken - Valid Strava access token
 * @param params - Pagination and filtering parameters
 * @returns Array of Strava activity summaries and the raw response for rate limit checking
 */
export async function fetchAthleteActivities(
  accessToken: string,
  params: FetchActivitiesParams = {},
): Promise<{ activities: StravaActivitySummary[]; response: RateLimitedResponse }> {
  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`)

  if (params.after !== undefined) {
    url.searchParams.set('after', String(params.after))
  }

  url.searchParams.set('per_page', String(params.perPage ?? 200))
  url.searchParams.set('page', String(params.page ?? 1))

  console.log(`[strava] Fetching ${url.toString()}`)

  const response = await fetchWithRateLimit(url.toString(), accessToken)

  console.log(`[strava] Response status: ${response.status}`)

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[strava] API error (${response.status}): ${errorText}`)
    throw new Error(
      `Strava API error (${response.status}): ${errorText}`,
    )
  }

  const activities = (await response.json()) as StravaActivitySummary[]
  console.log(`[strava] Fetched ${activities.length} activities`)

  return { activities, response }
}
