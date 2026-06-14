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
import { computePolylineOverlap } from "../lib/polyline-overlap";
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

/** Minimum polyline overlap ratio to consider two rides as "together" */
const MIN_POLYLINE_OVERLAP = 0.3;

/** Page size for group rides listing */
const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic group ride ID from date + route + sorted rider IDs.
 * Uses SHA-256 truncated to 16 hex chars for URL-friendly IDs.
 */
async function generateGroupRideId(
  date: string,
  routeCategory: RouteCategory,
  riderIds: string[],
): Promise<string> {
  const sorted = [...riderIds].sort();
  const input = `${date}:${routeCategory}:${sorted.join(",")}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex.substring(0, 16);
}

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

/**
 * Cluster co-ride pairs into connected components.
 * Each component represents a group ride.
 */
function clusterIntoGroups(
  pairs: Array<{
    rider1Id: string;
    rider2Id: string;
    ride1Id: string;
    ride2Id: string;
    date: string;
    route: RouteCategory;
  }>,
): Array<{
  riderIds: Set<string>;
  rideIds: Set<string>;
  date: string;
  route: RouteCategory;
}> {
  if (pairs.length === 0) return [];

  // Group pairs by date + route first
  const byDateRoute = new Map<string, typeof pairs>();
  for (const pair of pairs) {
    const key = `${pair.date}::${pair.route}`;
    const group = byDateRoute.get(key);
    if (group) {
      group.push(pair);
    } else {
      byDateRoute.set(key, [pair]);
    }
  }

  const groups: Array<{
    riderIds: Set<string>;
    rideIds: Set<string>;
    date: string;
    route: RouteCategory;
  }> = [];

  for (const [, datePairs] of byDateRoute) {
    // Union-Find for connected components
    const parent = new Map<string, string>();

    function find(x: string): string {
      if (!parent.has(x)) parent.set(x, x);
      const px = parent.get(x)!;
      if (px !== x) {
        const root = find(px);
        parent.set(x, root);
        return root;
      }
      return x;
    }

    function union(a: string, b: string): void {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    // Track which ride IDs belong to which rider
    const riderRides = new Map<string, Set<string>>();

    for (const pair of datePairs) {
      union(pair.rider1Id, pair.rider2Id);

      if (!riderRides.has(pair.rider1Id))
        riderRides.set(pair.rider1Id, new Set());
      if (!riderRides.has(pair.rider2Id))
        riderRides.set(pair.rider2Id, new Set());
      riderRides.get(pair.rider1Id)!.add(pair.ride1Id);
      riderRides.get(pair.rider2Id)!.add(pair.ride2Id);
    }

    // Collect components
    const components = new Map<string, Set<string>>();
    for (const riderId of parent.keys()) {
      const root = find(riderId);
      if (!components.has(root)) components.set(root, new Set());
      components.get(root)!.add(riderId);
    }

    for (const [, riderSet] of components) {
      if (riderSet.size < 2) continue; // Solo ride, not a group

      const rideIds = new Set<string>();
      for (const riderId of riderSet) {
        const rides = riderRides.get(riderId);
        if (rides) {
          for (const rideId of rides) rideIds.add(rideId);
        }
      }

      groups.push({
        riderIds: riderSet,
        rideIds,
        date: datePairs[0].date,
        route: datePairs[0].route,
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Server Function: Fetch group rides list
// ---------------------------------------------------------------------------

export const fetchGroupRides = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      page?: number;
      sortBy?: string;
      sortDir?: "asc" | "desc";
      dateFrom?: string;
      dateTo?: string;
      routeCategories?: string[];
      weekends?: boolean;
    }) => input,
  )
  .handler(async ({ data }): Promise<GroupRidesResponse> => {
    const supabase = createAnonClient();
    const page = data.page ?? 1;
    const sortBy = data.sortBy ?? "date";
    const sortDir = data.sortDir ?? "desc";

    // 1. Fetch all co-ride pairs from materialized view
    // Paginate to work around Supabase max_rows (1000) truncation
    const CO_RIDE_PAGE_SIZE = 1000;
    const allCoRides: CoRideRow[] = [];
    let coRideOffset = 0;
    let hasMoreCoRides = true;

    while (hasMoreCoRides) {
      const { data: page, error: pageError } = await supabase
        .from("ride_co_occurrences" as never)
        .select(
          "ride1_id, rider1_id, ride2_id, rider2_id, route_category, ride_date, polyline1, polyline2",
        )
        .range(coRideOffset, coRideOffset + CO_RIDE_PAGE_SIZE - 1)
        .order("ride_date", { ascending: false });

      if (pageError) {
        throw new Error(`Failed to fetch co-ride data: ${pageError.message}`);
      }

      if (!page || page.length === 0) {
        hasMoreCoRides = false;
      } else {
        allCoRides.push(...(page as CoRideRow[]));
        coRideOffset += page.length;
        if (page.length < CO_RIDE_PAGE_SIZE) {
          hasMoreCoRides = false;
        }
      }
    }

    console.log(
      `[group-rides] Paginated fetch: ${allCoRides.length} total co-ride rows`,
    );

    const coRides = allCoRides;
    const typedCoRides = coRides as CoRideRow[];

    // 2. Apply Layer 3: polyline overlap filter
    const validPairs: Array<{
      rider1Id: string;
      rider2Id: string;
      ride1Id: string;
      ride2Id: string;
      date: string;
      route: RouteCategory;
    }> = [];

    for (const row of typedCoRides) {
      // Date filter
      if (data.dateFrom && row.ride_date < data.dateFrom) continue;
      if (data.dateTo && row.ride_date > data.dateTo) continue;

      // Route category filter
      if (data.routeCategories && data.routeCategories.length > 0) {
        if (!data.routeCategories.includes(row.route_category)) continue;
      }

      // Weekend filter (weekends=false means exclude weekends)
      if (data.weekends === false) {
        const dayOfWeek = new Date(row.ride_date + "T12:00:00Z").getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      }

      // Skip if polylines exist but don't overlap enough
      if (row.polyline1 && row.polyline2) {
        const overlap = computePolylineOverlap(row.polyline1, row.polyline2);
        if (overlap < MIN_POLYLINE_OVERLAP) continue;
      }

      validPairs.push({
        rider1Id: row.rider1_id,
        rider2Id: row.rider2_id,
        ride1Id: row.ride1_id,
        ride2Id: row.ride2_id,
        date: row.ride_date,
        route: row.route_category,
      });
    }

    // 3. Cluster into connected components (group rides)
    const groups = clusterIntoGroups(validPairs);

    // 4. Fetch ride data for stats
    const allRideIds = new Set<string>();
    for (const group of groups) {
      for (const rideId of group.rideIds) allRideIds.add(rideId);
    }

    const { data: ridesData, error: ridesError } = await supabase
      .from("rides")
      .select(
        "id, user_id, ride_date, route_category, average_speed_mps, max_speed_mps, distance_meters, elevation_gain_meters, average_watts, max_watts, average_heartrate, max_heartrate, moving_time_seconds",
      )
      .in("id", Array.from(allRideIds));

    if (ridesError) {
      throw new Error(`Failed to fetch rides: ${ridesError.message}`);
    }

    const rideMap = new Map<string, RideRow>();
    for (const ride of (ridesData ?? []) as RideRow[]) {
      rideMap.set(ride.id, ride);
    }

    // 5. Fetch user data for display names + avatars
    const allUserIds = new Set<string>();
    for (const group of groups) {
      for (const riderId of group.riderIds) allUserIds.add(riderId);
    }

    const { data: usersData, error: usersError } = await supabase
      .from("users")
      .select("id, display_name, avatar_url")
      .in("id", Array.from(allUserIds));

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    const userMap = new Map<string, UserRow>();
    for (const user of (usersData ?? []) as UserRow[]) {
      userMap.set(user.id, user);
    }

    // 6. Build group ride summaries with stats
    const groupRideSummaries: GroupRideSummary[] = [];

    for (const group of groups) {
      const groupRides: RideRow[] = [];
      for (const rideId of group.rideIds) {
        const ride = rideMap.get(rideId);
        if (ride) groupRides.push(ride);
      }

      if (groupRides.length === 0) continue;

      // Compute aggregated stats
      const speeds = groupRides
        .map((r) => r.average_speed_mps)
        .filter((v): v is number => v != null);
      const maxSpeeds = groupRides
        .map((r) => r.max_speed_mps)
        .filter((v): v is number => v != null);
      const watts = groupRides
        .map((r) => r.average_watts)
        .filter((v): v is number => v != null);
      const maxWatts = groupRides
        .map((r) => r.max_watts)
        .filter((v): v is number => v != null);
      const heartrates = groupRides
        .map((r) => r.average_heartrate)
        .filter((v): v is number => v != null);
      const distances = groupRides
        .map((r) => r.distance_meters)
        .filter((v): v is number => v != null);
      const elevations = groupRides
        .map((r) => r.elevation_gain_meters)
        .filter((v): v is number => v != null);

      const avg = (arr: number[]) =>
        arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
      const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
      const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);

      const riders: GroupRideRider[] = Array.from(group.riderIds).map(
        (riderId) => {
          const user = userMap.get(riderId);
          return {
            userId: riderId,
            displayName: user?.display_name ?? "Rider",
            avatarUrl: user?.avatar_url ?? null,
          };
        },
      );

      const id = await generateGroupRideId(
        group.date,
        group.route,
        Array.from(group.riderIds),
      );

      groupRideSummaries.push({
        id,
        date: group.date,
        routeCategory: group.route,
        riders,
        riderCount: riders.length,
        avgSpeedMps: avg(speeds),
        avgWatts: watts.length > 0 ? avg(watts) : null,
        avgHeartrate: heartrates.length > 0 ? avg(heartrates) : null,
        maxWatts: maxWatts.length > 0 ? max(maxWatts) : null,
        maxSpeedMps: max(maxSpeeds),
        totalDistanceMeters: sum(distances),
        totalElevationMeters: sum(elevations),
      });
    }

    // 7. Sort
    groupRideSummaries.sort((a, b) => {
      let va: number, vb: number;
      switch (sortBy) {
        case "riderCount":
          va = a.riderCount;
          vb = b.riderCount;
          break;
        case "avgSpeedMps":
          va = a.avgSpeedMps;
          vb = b.avgSpeedMps;
          break;
        case "avgWatts":
          va = a.avgWatts ?? -1;
          vb = b.avgWatts ?? -1;
          break;
        case "avgHeartrate":
          va = a.avgHeartrate ?? -1;
          vb = b.avgHeartrate ?? -1;
          break;
        case "maxWatts":
          va = a.maxWatts ?? -1;
          vb = b.maxWatts ?? -1;
          break;
        case "maxSpeedMps":
          va = a.maxSpeedMps;
          vb = b.maxSpeedMps;
          break;
        case "totalDistanceMeters":
          va = a.totalDistanceMeters;
          vb = b.totalDistanceMeters;
          break;
        case "totalElevationMeters":
          va = a.totalElevationMeters;
          vb = b.totalElevationMeters;
          break;
        case "date":
        default:
          va = new Date(a.date).getTime();
          vb = new Date(b.date).getTime();
          break;
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });

    // 8. Return all group rides (dataset is small enough — ~100-200 groups)
    return {
      groupRides: groupRideSummaries,
      totalCount: groupRideSummaries.length,
      page: 1,
      pageSize: groupRideSummaries.length,
    };
  });

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

export const fetchGroupRideDetail = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      id: string;
      date: string;
      route: RouteCategory;
      riderIds: string[];
    }) => input,
  )
  .handler(async ({ data }): Promise<GroupRideDetail> => {
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
      .eq("route_category", data.route);

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
  });
