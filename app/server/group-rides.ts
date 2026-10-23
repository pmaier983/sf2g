/**
 * Server functions for the Group Rides feature.
 *
 * Group rides are derived from the existing `ride_co_occurrences` materialized
 * view using connected-component clustering. Each group ride gets a deterministic
 * ID via SHA-256 hashing of (date + route + sorted rider IDs).
 *
 * Stream data (GPS, time, power, HR) is lazily fetched from Strava on first
 * view and cached permanently in the `ride_streams` table.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient, createServiceClient } from "../lib/supabase";

import { ensureValidToken } from "../lib/strava-oauth";
import { fetchWithRateLimit, isApproachingLimit } from "../lib/rate-limiter";
import { STRAVA_API_BASE } from "../lib/constants";
import type {
  RouteCategory,
  Ride,
  RideStreamInsert,
} from "../lib/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupRideRider {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface GroupRideSummary {
  id: string;
  date: string;
  routeCategory: RouteCategory;
  riders: GroupRideRider[];
  riderCount: number;
  avgSpeedMps: number;
  avgWatts: number | null;
  avgHeartrate: number | null;
  maxWatts: number | null;
  maxSpeedMps: number;
  totalDistanceMeters: number;
  totalElevationMeters: number;
}

export interface GroupRidesResponse {
  groupRides: GroupRideSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface GroupRideDetailRider {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  ride: Ride;
  streams: {
    latlng: [number, number][];
    time: number[];
    watts?: number[];
    heartrate?: number[];
  } | null;
}

export interface GroupRideDetail {
  id: string;
  date: string;
  routeCategory: RouteCategory;
  riders: GroupRideDetailRider[];
  /** Errors encountered during stream fetching */
  streamErrors: StreamFetchError[];
}

/** Typed error for stream fetch failures */
export interface StreamFetchError {
  userId: string;
  displayName: string;
  type:
    | "RATE_LIMITED_15MIN"
    | "RATE_LIMITED_DAILY"
    | "REAUTH_REQUIRED"
    | "PRIVATE_ACTIVITY"
    | "FETCH_ERROR";
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum spatial overlap ratio required between two routes */
const MIN_POLYLINE_OVERLAP = 0.3;

/**
 * Max IDs per Supabase .in() filter to stay within URL length limits.
 * UUIDs are 36 chars each; 300 × 36 ≈ 10.8 KB which is well under the ~15 KB
 * GET URL limit that Supabase/PostgREST enforces.
 */
const IN_BATCH_SIZE = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse Strava rate limit headers to determine if it's a 15-min or daily limit.
 */
function parseRateLimitType(
  headers: Headers,
): "RATE_LIMITED_15MIN" | "RATE_LIMITED_DAILY" {
  const usage = headers.get("X-RateLimit-Usage");
  if (usage) {
    const parts = usage.split(",");
    if (parts.length >= 2) {
      const daily = parseInt(parts[1], 10);
      // If daily usage is above 900 (out of 1000), it's a daily limit
      if (!isNaN(daily) && daily >= 900) {
        return "RATE_LIMITED_DAILY";
      }
    }
  }
  return "RATE_LIMITED_15MIN";
}

// ---------------------------------------------------------------------------
// Internal: Fetch co-ride pairs and cluster into group rides
// ---------------------------------------------------------------------------

interface CoRideRow {
  ride1_id: string;
  rider1_id: string;
  ride2_id: string;
  rider2_id: string;
  route_category: RouteCategory;
  ride_date: string;
  polyline1: string | null;
  polyline2: string | null;
}

interface RideRow {
  id: string;
  user_id: string;
  ride_date: string;
  route_category: RouteCategory | null;
  average_speed_mps: number | null;
  max_speed_mps: number | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  average_watts: number | null;
  max_watts: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  moving_time_seconds: number | null;
}

interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// ---------------------------------------------------------------------------
// Server Function: Fetch group rides list (lightweight — reads pre-computed table)
// ---------------------------------------------------------------------------

/** Page size for group rides pagination */
const PAGE_SIZE = 25;

/**
 * Map sort field names from the client to actual database column names.
 */
function mapSortColumn(sortBy: string): string {
  switch (sortBy) {
    case "riderCount":
      return "rider_count";
    case "avgSpeedMps":
      return "avg_speed_mps";
    case "avgWatts":
      return "avg_watts";
    case "avgHeartrate":
      return "avg_heartrate";
    case "maxWatts":
      return "max_watts";
    case "maxSpeedMps":
      return "max_speed_mps";
    case "totalDistanceMeters":
      return "total_distance_meters";
    case "totalElevationMeters":
      return "total_elevation_meters";
    case "date":
    default:
      return "ride_date";
  }
}

const fetchGroupRidesInput = (input: {
  page?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  dateFrom?: string;
  dateTo?: string;
  routeCategories?: string[];
  weekends?: boolean;
}) => input;

export async function fetchGroupRidesImpl(
  data: ReturnType<typeof fetchGroupRidesInput>,
): Promise<GroupRidesResponse> {
  const supabase = createAnonClient();
  const page = Math.max(1, data.page ?? 1);
  const sortBy = data.sortBy ?? "date";
  const sortDir = data.sortDir ?? "desc";
  const sortColumn = mapSortColumn(sortBy);

  // Build query against pre-computed group_rides table
  let query = supabase
    .from("group_rides" as never)
    .select("*, group_ride_members(*)", { count: "exact" })
    .order(sortColumn, { ascending: sortDir === "asc" })
    .order("id", { ascending: true }); // unique tiebreaker: stable paging

  // Apply filters
  if (data.dateFrom) {
    query = query.gte("ride_date", data.dateFrom);
  }
  if (data.dateTo) {
    query = query.lte("ride_date", data.dateTo);
  }
  if (data.routeCategories && data.routeCategories.length > 0) {
    query = query.in("route_category", data.routeCategories);
  }

  // Weekend filter — exclude Saturday (6) and Sunday (0)
  // Supabase doesn't support day-of-week filtering in PostgREST,
  // so we apply it client-side after fetch if needed.
  // For now, fetch the page and filter if weekends === false.

  // Paginate
  const offset = (page - 1) * PAGE_SIZE;
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const { data: rows, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch group rides: ${error.message}`);
  }

  // Transform database rows to GroupRideSummary format
  const groupRides: GroupRideSummary[] = [];

  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const members = (row.group_ride_members ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
    }>;

    const rideDate = row.ride_date as string;

    // Weekend filter (client-side since PostgREST can't filter by day-of-week)
    if (data.weekends === false) {
      const dayOfWeek = new Date(rideDate + "T12:00:00Z").getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    }

    groupRides.push({
      id: row.id as string,
      date: rideDate,
      routeCategory: row.route_category as RouteCategory,
      // The embedded select has no ORDER BY; sort so avatars don't shuffle
      // between page loads.
      riders: members
        .map((m) => ({
          userId: m.user_id,
          displayName: m.display_name ?? "Rider",
          avatarUrl: m.avatar_url ?? null,
        }))
        .sort(
          (a, b) =>
            a.displayName.localeCompare(b.displayName) ||
            a.userId.localeCompare(b.userId),
        ),
      riderCount: (row.rider_count as number) ?? members.length,
      avgSpeedMps: (row.avg_speed_mps as number) ?? 0,
      avgWatts: (row.avg_watts as number | null) ?? null,
      avgHeartrate: (row.avg_heartrate as number | null) ?? null,
      maxWatts: (row.max_watts as number | null) ?? null,
      maxSpeedMps: (row.max_speed_mps as number) ?? 0,
      totalDistanceMeters: (row.total_distance_meters as number) ?? 0,
      totalElevationMeters: (row.total_elevation_meters as number) ?? 0,
    });
  }

  return {
    groupRides,
    totalCount: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export const fetchGroupRides = createServerFn({ method: "GET" })
  .inputValidator(fetchGroupRidesInput)
  .handler(({ data }) => fetchGroupRidesImpl(data));

// ---------------------------------------------------------------------------
// Cron Function: Compute and store group rides in the database
// ---------------------------------------------------------------------------

/**
 * Recompute and store all group rides (SQL: recompute_group_rides, migration
 * 040). Clusters co-riding riders per date + route into connected components
 * with the same ids as before, so /group-rides/<id> links keep working.
 * Requires the service role.
 */
export async function computeAndStoreGroupRides(): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("recompute_group_rides");
  if (error) {
    throw new Error(`Failed to recompute group rides: ${error.message}`);
  }
  console.log(`[group-rides] Stored ${data} group rides`);
  return data ?? 0;
}

// ---------------------------------------------------------------------------
// Internal: Fetch and cache Strava streams for a single ride
// ---------------------------------------------------------------------------

async function fetchAndCacheStravaStreams(
  userId: string,
  rideId: string,
  stravaActivityId: number,
  displayName: string,
): Promise<{
  streams: {
    latlng: [number, number][];
    time: number[];
    watts?: number[];
    heartrate?: number[];
  } | null;
  error?: StreamFetchError;
}> {
  let accessToken: string;
  try {
    accessToken = await ensureValidToken(userId);
  } catch {
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: "REAUTH_REQUIRED",
        message: `${displayName} needs to re-login to Strava to share ride data.`,
      },
    };
  }

  const url = `${STRAVA_API_BASE}/activities/${stravaActivityId}/streams?keys=latlng,time,watts,heartrate&key_by_type=true`;

  let response: Response;
  try {
    response = await fetchWithRateLimit(url, accessToken, 2);
  } catch {
    // Rate limit exhausted after retries
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: "RATE_LIMITED_15MIN",
        message: "Strava rate limit reached. Try again in ~15 minutes.",
      },
    };
  }

  // Check for rate limit response
  if (response.status === 429) {
    const limitType = parseRateLimitType(response.headers);
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: limitType,
        message:
          limitType === "RATE_LIMITED_DAILY"
            ? "Daily Strava API limit reached. Try again tomorrow."
            : "Strava rate limit reached. Try again in ~15 minutes.",
      },
    };
  }

  // Private activity
  if (response.status === 404 || response.status === 403) {
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: "PRIVATE_ACTIVITY",
        message: `${displayName}'s ride is private or unavailable.`,
      },
    };
  }

  if (!response.ok) {
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: "FETCH_ERROR",
        message: `Failed to fetch streams for ${displayName} (HTTP ${response.status}).`,
      },
    };
  }

  // Parse streams response
  const streamData = (await response.json()) as Record<
    string,
    { data: unknown[] }
  >;

  const latlng = (streamData.latlng?.data ?? []) as [number, number][];
  const time = (streamData.time?.data ?? []) as number[];
  const watts = streamData.watts?.data as number[] | undefined;
  const heartrate = streamData.heartrate?.data as number[] | undefined;

  if (latlng.length === 0 || time.length === 0) {
    return {
      streams: null,
      error: {
        userId,
        displayName,
        type: "FETCH_ERROR",
        message: `No GPS/time stream data available for ${displayName}'s ride.`,
      },
    };
  }

  // Cache in ride_streams table (service client for writes)
  const serviceClient = createServiceClient();
  const insert: RideStreamInsert = {
    ride_id: rideId,
    latlng_stream: latlng,
    time_stream: time,
    watts_stream: watts ?? null,
    heartrate_stream: heartrate ?? null,
  };

  const { error: upsertError } = await serviceClient
    .from("ride_streams")
    .upsert(insert as never, { onConflict: "ride_id" });

  if (upsertError) {
    console.error(
      `[group-rides] Failed to cache streams for ride ${rideId}:`,
      upsertError.message,
    );
    // Non-fatal: we still return the streams, just don't cache
  }

  // Check if approaching rate limit after this request
  const approaching = isApproachingLimit(response.headers);

  return {
    streams: {
      latlng,
      time,
      watts: watts ?? undefined,
      heartrate: heartrate ?? undefined,
    },
    error: approaching
      ? {
          userId,
          displayName,
          type: "RATE_LIMITED_15MIN",
          message:
            "Approaching Strava rate limit. Some streams may not be fetched.",
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Server Function: Fetch group ride detail with streams
// ---------------------------------------------------------------------------

/**
 * Deterministic group-ride id: first 16 hex chars of
 * SHA-256("date:route:sorted rider ids"). recompute_group_rides (SQL) uses the
 * same formula; the detail page re-derives it to validate its URL params.
 */
async function generateGroupRideId(
  date: string,
  routeCategory: RouteCategory,
  riderIds: string[],
): Promise<string> {
  const sorted = [...riderIds].sort();
  const input = `${date}:${routeCategory}:${sorted.join(",")}`;
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}

const fetchGroupRideDetailInput = (input: {
  id: string;
  date: string;
  route: RouteCategory;
  riderIds: string[];
}) => input;

export async function fetchGroupRideDetailImpl(
  data: ReturnType<typeof fetchGroupRideDetailInput>,
): Promise<GroupRideDetail> {
  const supabase = createAnonClient();

  // 1. Verify the deterministic ID matches
  const expectedId = await generateGroupRideId(
    data.date,
    data.route,
    data.riderIds,
  );
  if (expectedId !== data.id) {
    throw new Error("Group ride ID mismatch — invalid parameters.");
  }

  // 2. Fetch all rides for these riders on this date + route
  const { data: ridesData, error: ridesError } = await supabase
    .from("rides")
    .select("*")
    .in("user_id", data.riderIds)
    .eq("ride_date", data.date)
    .eq("route_category", data.route)
    // Stable order: rider colors on the detail page are assigned by position.
    .order("start_date", { ascending: true })
    .order("id", { ascending: true });

  if (ridesError) {
    throw new Error(`Failed to fetch rides: ${ridesError.message}`);
  }

  const rides = (ridesData ?? []) as Ride[];

  // 3. Fetch user data
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("id, display_name, avatar_url")
    .in("id", data.riderIds);

  if (usersError) {
    throw new Error(`Failed to fetch users: ${usersError.message}`);
  }

  const userMap = new Map<string, UserRow>();
  for (const user of (usersData ?? []) as UserRow[]) {
    userMap.set(user.id, user);
  }

  // 4. Check for cached streams
  const rideIds = rides.map((r) => r.id);
  const { data: cachedStreams } = await supabase
    .from("ride_streams")
    .select("*")
    .in("ride_id", rideIds);

  const cachedStreamMap = new Map<
    string,
    {
      latlng: [number, number][];
      time: number[];
      watts?: number[];
      heartrate?: number[];
    }
  >();
  for (const cached of (cachedStreams ?? []) as unknown as Array<{
    ride_id: string;
    latlng_stream: [number, number][];
    time_stream: number[];
    watts_stream: number[] | null;
    heartrate_stream: number[] | null;
  }>) {
    cachedStreamMap.set(cached.ride_id, {
      latlng: cached.latlng_stream,
      time: cached.time_stream,
      watts: cached.watts_stream ?? undefined,
      heartrate: cached.heartrate_stream ?? undefined,
    });
  }

  // 5. Fetch missing streams from Strava (sequentially to respect rate limits)
  const streamErrors: StreamFetchError[] = [];
  const rideStreamMap = new Map<
    string,
    {
      latlng: [number, number][];
      time: number[];
      watts?: number[];
      heartrate?: number[];
    } | null
  >();
  let hitRateLimit = false;

  for (const ride of rides) {
    // Use cached stream if available
    const cached = cachedStreamMap.get(ride.id);
    if (cached) {
      rideStreamMap.set(ride.id, cached);
      continue;
    }

    // Skip further fetches if we already hit a rate limit
    if (hitRateLimit) {
      const user = userMap.get(ride.user_id);
      rideStreamMap.set(ride.id, null);
      streamErrors.push({
        userId: ride.user_id,
        displayName: user?.display_name ?? "Rider",
        type: "RATE_LIMITED_15MIN",
        message: "Skipped due to earlier rate limit.",
      });
      continue;
    }

    const user = userMap.get(ride.user_id);
    const result = await fetchAndCacheStravaStreams(
      ride.user_id,
      ride.id,
      ride.strava_activity_id,
      user?.display_name ?? "Rider",
    );

    rideStreamMap.set(ride.id, result.streams);

    if (result.error) {
      streamErrors.push(result.error);
      if (
        result.error.type === "RATE_LIMITED_15MIN" ||
        result.error.type === "RATE_LIMITED_DAILY"
      ) {
        hitRateLimit = true;
      }
    }
  }

  // 6. Build rider detail array
  const riderDetails: GroupRideDetailRider[] = rides.map((ride) => {
    const user = userMap.get(ride.user_id);
    return {
      userId: ride.user_id,
      displayName: user?.display_name ?? "Rider",
      avatarUrl: user?.avatar_url ?? null,
      ride,
      streams: rideStreamMap.get(ride.id) ?? null,
    };
  });

  return {
    id: data.id,
    date: data.date,
    routeCategory: data.route,
    riders: riderDetails,
    streamErrors,
  };
}

export const fetchGroupRideDetail = createServerFn({ method: "GET" })
  .inputValidator(fetchGroupRideDetailInput)
  .handler(({ data }) => fetchGroupRideDetailImpl(data));
