/**
 * Strava API client helpers.
 *
 * All Strava API calls go through `fetchWithRateLimit()` to respect rate limits.
 *
 * - `fetchAthleteActivities(accessToken, params)` — paginated activity list
 * - `fetchActivityDetail(accessToken, id)` — one activity with all its segment efforts
 * - `fetchSegment(accessToken, id)` — one segment with its KOM/QOM times
 */

import { STRAVA_API_BASE } from "./constants";
import { fetchWithRateLimit, type RateLimitedResponse } from "./rate-limiter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for fetching athlete activities */
export interface FetchActivitiesParams {
  /** Epoch timestamp — return only activities after this time (oldest first) */
  after?: number;
  /** Epoch timestamp — return only activities before this time (newest first) */
  before?: number;
  /** Number of activities per page (max 200) */
  perPage?: number;
  /** Page number (1-indexed) */
  page?: number;
}

/**
 * Strava activity summary from the list endpoint.
 * This is a simplified type — Strava returns many more fields.
 */
export interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local: string;
  timezone: string;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  average_speed: number;
  max_speed: number;
  map: {
    id: string;
    summary_polyline: string | null;
    resource_state: number;
  };
  commute: boolean;
  manual: boolean;
  private: boolean;
  trainer: boolean;
  // Power data (optional — only present if rider has a power meter)
  average_watts?: number;
  max_watts?: number;
  weighted_average_watts?: number;
  kilojoules?: number;
  // Heart rate data (optional — only present if rider has HR monitor)
  has_heartrate?: boolean;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
}

/** The segment summary embedded in every segment effort. */
export interface StravaSegmentSummary {
  id: number;
  name: string;
  activity_type: string;
  distance: number;
  average_grade: number;
  maximum_grade: number;
  elevation_high: number;
  elevation_low: number;
  climb_category: number;
  start_latlng: [number, number];
  end_latlng: [number, number];
  private: boolean;
  hazardous: boolean;
}

/** One effort from `segment_efforts[]` of a detailed activity. */
export interface StravaSegmentEffort {
  id: number;
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  start_date_local: string;
  distance: number;
  kom_rank: number | null;
  pr_rank: number | null;
  average_watts?: number;
  device_watts?: boolean;
  segment: StravaSegmentSummary;
}

/** `GET /activities/{id}?include_all_efforts=true` */
export interface StravaActivityDetail extends StravaActivitySummary {
  segment_efforts?: StravaSegmentEffort[];
}

/** `GET /segments/{id}` — xoms are strings like "4:49", with no holder name. */
export interface StravaSegmentDetail extends StravaSegmentSummary {
  effort_count: number;
  athlete_count: number;
  xoms?: { kom?: string; qom?: string; overall?: string };
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
): Promise<{
  activities: StravaActivitySummary[];
  response: RateLimitedResponse;
}> {
  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);

  if (params.after !== undefined) {
    url.searchParams.set("after", String(params.after));
  }
  if (params.before !== undefined) {
    url.searchParams.set("before", String(params.before));
  }

  url.searchParams.set("per_page", String(params.perPage ?? 200));
  url.searchParams.set("page", String(params.page ?? 1));

  console.log(`[strava] Fetching ${url.toString()}`);

  const response = await fetchWithRateLimit(url.toString(), accessToken);

  console.log(`[strava] Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[strava] API error (${response.status}): ${errorText}`);
    throw new Error(`Strava API error (${response.status}): ${errorText}`);
  }

  const activities = (await response.json()) as StravaActivitySummary[];
  console.log(`[strava] Fetched ${activities.length} activities`);

  return { activities, response };
}

/**
 * Fetch a single activity from Strava API by ID.
 *
 * Used by the webhook handler to fetch full activity details after receiving
 * a webhook event (which only contains the activity ID, not the full data).
 *
 * @param accessToken - Valid Strava access token
 * @param activityId - Strava activity ID
 * @returns The activity summary and the raw response for rate limit checking
 */
export async function fetchSingleActivity(
  accessToken: string,
  activityId: number,
): Promise<{ activity: StravaActivitySummary; response: RateLimitedResponse }> {
  const url = `${STRAVA_API_BASE}/activities/${activityId}`;

  console.log(`[strava] Fetching single activity ${activityId}`);

  const response = await fetchWithRateLimit(url, accessToken);

  console.log(`[strava] Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[strava] API error (${response.status}): ${errorText}`);
    throw new Error(`Strava API error (${response.status}): ${errorText}`);
  }

  const activity = (await response.json()) as StravaActivitySummary;
  console.log(`[strava] Fetched activity: ${activity.name} (${activity.type})`);

  return { activity, response };
}

/**
 * Fetch one activity with every segment effort in it (one read).
 *
 * Used by the segment_efforts job; the response is mapped to rows and never
 * stored raw (Strava API terms).
 */
export async function fetchActivityDetail(
  accessToken: string,
  activityId: number,
): Promise<{ activity: StravaActivityDetail; response: RateLimitedResponse }> {
  const url = `${STRAVA_API_BASE}/activities/${activityId}?include_all_efforts=true`;

  console.log(`[strava] Fetching activity detail ${activityId}`);

  const response = await fetchWithRateLimit(url, accessToken);

  console.log(`[strava] Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[strava] API error (${response.status}): ${errorText}`);
    throw new Error(`Strava API error (${response.status}): ${errorText}`);
  }

  const activity = (await response.json()) as StravaActivityDetail;
  console.log(
    `[strava] Fetched activity ${activity.id} with ${activity.segment_efforts?.length ?? 0} segment efforts`,
  );

  return { activity, response };
}

/** Fetch one segment, including its KOM/QOM times (one read). */
export async function fetchSegment(
  accessToken: string,
  segmentId: number,
): Promise<{ segment: StravaSegmentDetail; response: RateLimitedResponse }> {
  const url = `${STRAVA_API_BASE}/segments/${segmentId}`;

  console.log(`[strava] Fetching segment ${segmentId}`);

  const response = await fetchWithRateLimit(url, accessToken);

  console.log(`[strava] Response status: ${response.status}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[strava] API error (${response.status}): ${errorText}`);
    throw new Error(`Strava API error (${response.status}): ${errorText}`);
  }

  const segment = (await response.json()) as StravaSegmentDetail;
  console.log(`[strava] Fetched segment: ${segment.name}`);

  return { segment, response };
}
