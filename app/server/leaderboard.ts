/**
 * Leaderboard server functions.
 *
 * - `fetchLeaderboard` — queries the leaderboard_view materialized view
 *   (or falls back to date-filtered RPC when dateFrom/dateTo are provided)
 * - `fetchPprDawnRiderIds` — riders passing through PPR within 10 min of 6 AM
 * - `fetchRiderGrowthData` — monthly ride counts per rider (for growth chart)
 * - `fetchRouteSpeedLeaderboard` — speed rankings per route category
 * - `fetchCommunityBreakdown` — aggregate SF2G vs other distance/elevation
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type {
  LeaderboardEntry,
  MonthlyRideStat,
  RouteCategory,
  RouteSpeedEntry,
  PprDawnRide,
  DestinationCompany,
} from "../lib/database.types";
import { decodePolyline } from "../lib/polyline";
import { PPR_INTERCEPTS } from "../lib/constants";
import type { PprIntercept } from "../lib/constants";
import { getCommuteDirection } from "../lib/route-classifier";

// ---------------------------------------------------------------------------
// Route-category allow-list (mirrors rides.ts)
// ---------------------------------------------------------------------------
const VALID_ROUTE_CATEGORIES = new Set([
  "bayway",
  "skyline",
  "hmbw",
  "royale",
  "fleaway",
  "mebw",
  "febw",
  "other",
]);

// ---------------------------------------------------------------------------
// Column allow-list for sort validation
// ---------------------------------------------------------------------------
const VALID_LEADERBOARD_SORT_COLUMNS = new Set([
  "sf2g_total",
  "total_rides",
  "avg_speed_mps",
  "bayway_count",
  "skyline_count",
  "hmbw_count",
  "royale_count",
  "fleaway_count",
  "mebw_count",
  "febw_count",
  "other_count",
  "sf2g_distance_meters",
  "sf2g_elevation_meters",
  "total_distance_meters",
  "total_elevation_meters",
  "active_years",
  "last_ride_date",
  "first_ride_date",
  "display_name",
  "avg_watts",
  "avg_heartrate",
  "avg_kilojoules",
]);

/** Validate ISO date string format (YYYY-MM-DD) */
function isValidDateString(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

// ---------------------------------------------------------------------------
// fetchLeaderboard — reads from the materialized view (fast path) or
// queries the rides table via RPC when date filters are active.
// ---------------------------------------------------------------------------
export const fetchLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      sortBy?: string;
      sortDir?: "asc" | "desc";
      dateFrom?: string; // ISO date string e.g. '2024-01-01'
      dateTo?: string; // ISO date string
      excludeWeekends?: boolean;
    }) => input,
  )
  .handler(async ({ data }): Promise<LeaderboardEntry[]> => {
    const supabase = createAnonClient();

    // Validated sort params (shared by both paths)
    const sortColumn =
      data.sortBy && VALID_LEADERBOARD_SORT_COLUMNS.has(data.sortBy)
        ? data.sortBy
        : "sf2g_total";
    const ascending = (data.sortDir ?? "desc") === "asc";

    // Validate date params if provided
    const dateFrom =
      data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null;
    const dateTo =
      data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;

    // ----- Date-filtered path: query rides table via RPC -----
    if (dateFrom || dateTo) {
      const { data: rows, error } = await supabase.rpc(
        "get_leaderboard_by_date_range",
        {
          p_date_from: dateFrom ?? undefined,
          p_date_to: dateTo ?? undefined,
          p_exclude_weekends: data.excludeWeekends ?? true,
        },
      );

      if (error) {
        console.error(
          "[leaderboard] Failed to fetch date-filtered leaderboard:",
          error,
        );
        throw new Error(
          `Failed to fetch date-filtered leaderboard: ${error.message}`,
        );
      }

      // Sort in JS — simple, type-safe, avoids dynamic ORDER BY in SQL
      const sorted = [...(rows ?? [])].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortColumn] ?? 0;
        const bVal = (b as Record<string, unknown>)[sortColumn] ?? 0;
        if (aVal < bVal) return ascending ? -1 : 1;
        if (aVal > bVal) return ascending ? 1 : -1;
        return 0;
      });

      return sorted as LeaderboardEntry[];
    }

    // ----- Fast path: materialized view -----
    const { data: viewData, error } = await supabase
      .from("leaderboard_view")
      .select("*")
      .gt("total_rides", 0)
      .order(sortColumn, { ascending });

    if (error) {
      console.error("[leaderboard] Failed to fetch leaderboard:", error);
      throw new Error(`Failed to fetch leaderboard: ${error.message}`);
    }

    const entries = (viewData ?? []) as LeaderboardEntry[];

    // Check if the view has sf2g columns (migration 006+)
    // If not, compute them from the rides table
    const needsSf2gComputation =
      entries.length > 0 &&
      (entries[0].sf2g_distance_meters === undefined ||
        entries[0].sf2g_distance_meters === null);

    if (needsSf2gComputation) {
      // Fetch SF2G aggregate per user from rides table
      // Paginate to work around Supabase max_rows (1000) truncation
      type Sf2gAggRow = {
        user_id: string;
        distance_meters: number | null;
        elevation_gain_meters: number | null;
        average_speed_mps: number | null;
        route_category: string | null;
      };
      const PAGE_SIZE_SF2G = 1000;
      const allSf2gAggRows: Sf2gAggRow[] = [];
      let sf2gAggOffset = 0;
      let sf2gAggHasMore = true;

      while (sf2gAggHasMore) {
        const { data: page, error: pageError } = await supabase
          .from("rides")
          .select(
            "user_id, distance_meters, elevation_gain_meters, average_speed_mps, route_category",
          )
          .range(sf2gAggOffset, sf2gAggOffset + PAGE_SIZE_SF2G - 1)
          .order("ride_date", { ascending: true });

        if (pageError) {
          console.error(
            "[leaderboard] Failed to fetch SF2G aggregation rides:",
            pageError,
          );
          throw new Error(
            `Failed to fetch SF2G aggregation rides: ${pageError.message}`,
          );
        }

        if (!page || page.length === 0) {
          sf2gAggHasMore = false;
        } else {
          allSf2gAggRows.push(...(page as Sf2gAggRow[]));
          sf2gAggOffset += page.length;
          if (page.length < PAGE_SIZE_SF2G) {
            sf2gAggHasMore = false;
          }
        }
      }
      console.log(
        `[leaderboard] Paginated fetch (sf2gAgg): ${allSf2gAggRows.length} total rows`,
      );
      const sf2gAgg = allSf2gAggRows;

      // Build per-user SF2G aggregates
      const sf2gByUser = new Map<
        string,
        {
          distance: number;
          elevation: number;
          speedSum: number;
          speedCount: number;
          rideCount: number;
        }
      >();
      for (const ride of sf2gAgg) {
        if (ride.route_category === "other" || ride.route_category === null)
          continue;
        const existing = sf2gByUser.get(ride.user_id) ?? {
          distance: 0,
          elevation: 0,
          speedSum: 0,
          speedCount: 0,
          rideCount: 0,
        };
        existing.distance += ride.distance_meters ?? 0;
        existing.elevation += ride.elevation_gain_meters ?? 0;
        existing.rideCount += 1;
        if (ride.average_speed_mps != null) {
          existing.speedSum += ride.average_speed_mps;
          existing.speedCount += 1;
        }
        sf2gByUser.set(ride.user_id, existing);
      }

      // Patch entries with computed values
      for (const entry of entries) {
        const agg = sf2gByUser.get(entry.user_id ?? "");
        entry.sf2g_distance_meters = agg?.distance ?? 0;
        entry.sf2g_elevation_meters = agg?.elevation ?? 0;
        entry.sf2g_total = agg?.rideCount ?? 0;
        // avg_speed_mps should only average SF2G rides
        entry.avg_speed_mps =
          agg && agg.speedCount > 0 ? agg.speedSum / agg.speedCount : 0;
      }
    }

    return entries;
  });

// ---------------------------------------------------------------------------
// fetchFilteredLeaderboard — computes aggregated leaderboard from individual
// rides when compound filters (route + company + date) are active.
// ---------------------------------------------------------------------------
export const fetchFilteredLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      sortBy?: string;
      sortDir?: "asc" | "desc";
      dateFrom?: string;
      dateTo?: string;
      routeCategories?: string[];
      company?: string;
      excludeWeekends?: boolean;
      reverse?: boolean;
    }) => input,
  )
  .handler(async ({ data }): Promise<LeaderboardEntry[]> => {
    const supabase = createAnonClient();

    // Build rides query with all filters applied
    // TODO: The leaderboard_view materialized view SQL (migration 008) should also
    // add WHERE (is_private = false OR is_private IS NULL) AND (is_hidden = false OR is_hidden IS NULL)
    // to exclude private/hidden rides from pre-computed rankings.
    let query = supabase
      .from("rides")
      .select(
        "user_id, route_category, destination_company, distance_meters, elevation_gain_meters, average_speed_mps, tailwind_component_ms, average_watts, average_heartrate, kilojoules, ride_date, start_latlng, end_latlng",
      )
      .not("route_category", "is", null);

    // Strava API compliance: exclude hidden and private rides from public views
    query = query.or("is_hidden.eq.false,is_hidden.is.null");
    query = query.or("is_private.eq.false,is_private.is.null");

    // Route filter
    if (data.routeCategories && data.routeCategories.length > 0) {
      const validCats = data.routeCategories.filter((c) =>
        VALID_ROUTE_CATEGORIES.has(c),
      );
      if (validCats.length > 0) {
        query = query.in("route_category", validCats as RouteCategory[]);
      }
    }

    // Company filter
    if (data.company && VALID_COMPANIES.has(data.company)) {
      query = query.eq(
        "destination_company",
        data.company as DestinationCompany,
      );
    }

    // Date range filters
    const dateFrom =
      data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null;
    const dateTo =
      data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;
    if (dateFrom) query = query.gte("ride_date", dateFrom);
    if (dateTo) query = query.lte("ride_date", dateTo);

    // Paginate through ALL rides to work around Supabase's max_rows limit
    // (default 1000) which silently truncates .limit() calls.
    type FilteredRide = {
      user_id: string;
      route_category: string | null;
      destination_company: string | null;
      distance_meters: number | null;
      elevation_gain_meters: number | null;
      average_speed_mps: number | null;
      tailwind_component_ms: number | null;
      average_watts: number | null;
      average_heartrate: number | null;
      kilojoules: number | null;
      ride_date: string;
      start_latlng: [number, number] | null;
      end_latlng: [number, number] | null;
    };
    const PAGE_SIZE = 1000;
    const allRides: FilteredRide[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: pageError } = await query
        .range(offset, offset + PAGE_SIZE - 1)
        .order("ride_date", { ascending: false });

      if (pageError) {
        console.error(
          "[leaderboard] Failed to fetch filtered rides:",
          pageError,
        );
        throw new Error(`Failed to fetch filtered rides: ${pageError.message}`);
      }

      if (!page || page.length === 0) {
        hasMore = false;
      } else {
        allRides.push(...(page as FilteredRide[]));
        offset += page.length;
        // If we got fewer than PAGE_SIZE, we've reached the end
        if (page.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    }

    console.log(
      `[leaderboard] Paginated fetch: ${allRides.length} total rides in ${Math.ceil(offset / PAGE_SIZE)} pages`,
    );

    const rides = allRides;

    if (!rides || rides.length === 0) return [];

    // Filter out weekend rides if excludeWeekends is true (default)
    const excludeWeekends = data.excludeWeekends ?? true;
    const filteredRides = excludeWeekends
      ? rides.filter((r) => {
          const day = new Date(r.ride_date).getUTCDay();
          return day !== 0 && day !== 6; // exclude Sun(0) and Sat(6)
        })
      : rides;

    if (filteredRides.length === 0) return [];

    // Filter by commute direction when reverse filter is active (G2SF = Peninsula → SF)
    const directionFiltered = data.reverse
      ? filteredRides.filter((r) => {
          const startLatLng = r.start_latlng as [number, number] | null;
          const endLatLng = r.end_latlng as [number, number] | null;
          return getCommuteDirection(startLatLng, endLatLng) === "g2sf";
        })
      : filteredRides;

    if (directionFiltered.length === 0) return [];

    // Fetch per-user total distance/elevation from ALL rides via RPC.
    // IMPORTANT: We use an RPC function instead of fetching raw rides because
    // the Supabase REST API enforces a max_rows limit (default 1000) that
    // silently truncates .limit() calls. The RPC aggregates on the DB side,
    // bypassing this limit entirely.
    const { data: userTotalsRows, error: totalsError } = await supabase.rpc(
      "get_user_ride_totals",
      {
        p_date_from: dateFrom ?? undefined,
        p_date_to: dateTo ?? undefined,
      },
    );

    if (totalsError) {
      console.error(
        "[leaderboard] Failed to fetch user ride totals:",
        totalsError,
      );
      // Non-fatal: fall back to classified-only totals below
    }

    // Build per-user total distance/elevation map.
    // These totals include ALL rides (weekday + weekend, SF2G + non-SF2G)
    // so the percentage shows what share of total cycling is SF2G commuting.
    const userTotals = new Map<
      string,
      { distance: number; elevation: number }
    >();
    if (userTotalsRows) {
      for (const row of userTotalsRows) {
        userTotals.set(row.user_id, {
          distance: row.total_distance ?? 0,
          elevation: row.total_elevation ?? 0,
        });
      }
    }

    // Aggregate per user
    type UserAgg = {
      sf2g_total: number;
      total_rides: number;
      bayway_count: number;
      skyline_count: number;
      hmbw_count: number;
      royale_count: number;
      fleaway_count: number;
      mebw_count: number;
      febw_count: number;
      other_count: number;
      sf2g_distance: number;
      sf2g_elevation: number;
      total_distance: number;
      total_elevation: number;
      speedSum: number;
      speedCount: number;
      tailwindSum: number;
      tailwindCount: number;
      wattsSum: number;
      wattsCount: number;
      hrSum: number;
      hrCount: number;
      kjSum: number;
      kjCount: number;
      years: Set<number>;
      /** Per-year totals so we can filter to active SF2G years */
      yearDistance: Map<number, number>;
      yearElevation: Map<number, number>;
      lastRideDate: string | null;
      firstRideDate: string | null;
    };

    const userMap = new Map<string, UserAgg>();

    for (const ride of directionFiltered) {
      let agg = userMap.get(ride.user_id);
      if (!agg) {
        agg = {
          sf2g_total: 0,
          total_rides: 0,
          bayway_count: 0,
          skyline_count: 0,
          hmbw_count: 0,
          royale_count: 0,
          fleaway_count: 0,
          mebw_count: 0,
          febw_count: 0,
          other_count: 0,
          sf2g_distance: 0,
          sf2g_elevation: 0,
          total_distance: 0,
          total_elevation: 0,
          speedSum: 0,
          speedCount: 0,
          tailwindSum: 0,
          tailwindCount: 0,
          wattsSum: 0,
          wattsCount: 0,
          hrSum: 0,
          hrCount: 0,
          kjSum: 0,
          kjCount: 0,
          years: new Set<number>(),
          yearDistance: new Map<number, number>(),
          yearElevation: new Map<number, number>(),
          lastRideDate: null,
          firstRideDate: null,
        };
        userMap.set(ride.user_id, agg);
      }

      const cat = ride.route_category as string | null;
      agg.total_rides++;
      agg.total_distance += ride.distance_meters ?? 0;
      agg.total_elevation += ride.elevation_gain_meters ?? 0;

      // Track per-year distance/elevation for active-year filtering
      if (ride.ride_date) {
        const year = new Date(ride.ride_date).getFullYear();
        if (!isNaN(year)) {
          agg.yearDistance.set(
            year,
            (agg.yearDistance.get(year) ?? 0) + (ride.distance_meters ?? 0),
          );
          agg.yearElevation.set(
            year,
            (agg.yearElevation.get(year) ?? 0) +
              (ride.elevation_gain_meters ?? 0),
          );
        }
      }

      if (cat && cat !== "other") {
        agg.sf2g_total++;
        agg.sf2g_distance += ride.distance_meters ?? 0;
        agg.sf2g_elevation += ride.elevation_gain_meters ?? 0;

        // Count per route
        const countKey = `${cat}_count` as keyof UserAgg;
        if (countKey in agg && typeof agg[countKey] === "number") {
          (agg as unknown as Record<string, number>)[countKey]++;
        }

        // Speed
        if (ride.average_speed_mps != null) {
          agg.speedSum += ride.average_speed_mps;
          agg.speedCount++;
        }

        // Tailwind
        if (ride.tailwind_component_ms != null) {
          agg.tailwindSum += ride.tailwind_component_ms;
          agg.tailwindCount++;
        }

        // Watts
        if (ride.average_watts != null) {
          agg.wattsSum += ride.average_watts;
          agg.wattsCount++;
        }

        // Heart rate
        if (ride.average_heartrate != null) {
          agg.hrSum += ride.average_heartrate;
          agg.hrCount++;
        }

        // Kilojoules (calories)
        if ((ride as Record<string, unknown>).kilojoules != null) {
          agg.kjSum += (ride as Record<string, unknown>).kilojoules as number;
          agg.kjCount++;
        }

        // Active years
        if (ride.ride_date) {
          const year = new Date(ride.ride_date).getFullYear();
          if (!isNaN(year)) agg.years.add(year);
        }
      } else if (cat === "other") {
        agg.other_count++;
      }

      // Track first/last ride dates
      if (ride.ride_date) {
        if (!agg.lastRideDate || ride.ride_date > agg.lastRideDate) {
          agg.lastRideDate = ride.ride_date;
        }
        if (!agg.firstRideDate || ride.ride_date < agg.firstRideDate) {
          agg.firstRideDate = ride.ride_date;
        }
      }
    }

    // Get user display info
    const userIds = [...userMap.keys()];
    const { data: users } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, username")
      .in("id", userIds);

    const userInfo = new Map((users ?? []).map((u) => [u.id, u]));

    // Fetch unfiltered active_years from the materialized view
    // so the years badge always shows total career years, not filtered years
    const { data: unfilteredYears } = await supabase
      .from("leaderboard_view")
      .select("user_id, active_years")
      .in("user_id", userIds);

    const unfilteredYearsMap = new Map(
      (unfilteredYears ?? [])
        .filter(
          (u): u is { user_id: string; active_years: number } =>
            u.user_id != null && u.active_years != null,
        )
        .map((u) => [u.user_id, u.active_years] as [string, number]),
    );

    // Build LeaderboardEntry array
    const entries: LeaderboardEntry[] = [];
    for (const [userId, agg] of userMap) {
      const user = userInfo.get(userId);
      // Use ALL-rides totals for % dist/elev (includes unclassified rides);
      // fall back to classified-only totals if the second query failed
      const allTotals = userTotals.get(userId);
      entries.push({
        user_id: userId,
        display_name: user?.display_name ?? null,
        avatar_url: user?.avatar_url ?? null,
        username: user?.username ?? null,
        sf2g_total: agg.sf2g_total,
        total_rides: agg.total_rides,
        bayway_count: agg.bayway_count,
        skyline_count: agg.skyline_count,
        hmbw_count: agg.hmbw_count,
        royale_count: agg.royale_count,
        fleaway_count: agg.fleaway_count,
        mebw_count: agg.mebw_count,
        febw_count: agg.febw_count,
        other_count: agg.other_count,
        avg_speed_mps: agg.speedCount > 0 ? agg.speedSum / agg.speedCount : 0,
        sf2g_distance_meters: agg.sf2g_distance,
        sf2g_elevation_meters: agg.sf2g_elevation,
        // Use totals from ALL rides (including unclassified) for accurate % dist/elev
        total_distance_meters: allTotals?.distance ?? agg.total_distance,
        total_elevation_meters: allTotals?.elevation ?? agg.total_elevation,
        active_years: unfilteredYearsMap.get(userId) ?? agg.years.size,
        last_ride_date: agg.lastRideDate,
        first_ride_date: agg.firstRideDate,
        avg_tailwind_ms:
          agg.tailwindCount > 0 ? agg.tailwindSum / agg.tailwindCount : 0,
        avg_watts: agg.wattsCount > 0 ? agg.wattsSum / agg.wattsCount : null,
        avg_heartrate: agg.hrCount > 0 ? agg.hrSum / agg.hrCount : null,
        avg_kilojoules: agg.kjCount > 0 ? agg.kjSum / agg.kjCount : null,
      });
    }

    // Sort
    const sortColumn =
      data.sortBy && VALID_LEADERBOARD_SORT_COLUMNS.has(data.sortBy)
        ? data.sortBy
        : "sf2g_total";
    const ascending = (data.sortDir ?? "desc") === "asc";

    entries.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortColumn] ?? 0;
      const bVal = (b as Record<string, unknown>)[sortColumn] ?? 0;
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });

    return entries;
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PPR_RADIUS_METERS = 500;

/**
 * Estimate when a ride passes through a specific intercept point.
 * Uses linear interpolation along the summary polyline.
 */
function estimateInterceptArrival(
  ride: PprDawnRide,
  intercept: PprIntercept,
): Date | null {
  if (!ride.summary_polyline) return null;
  const points = decodePolyline(ride.summary_polyline);
  if (points.length === 0) return null;

  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i];
    const dist = haversineDistance(lat, lng, intercept.lat, intercept.lng);
    if (dist <= PPR_RADIUS_METERS) {
      const fraction = points.length > 1 ? i / (points.length - 1) : 0;
      const movingTimeMs = (ride.moving_time_seconds ?? 0) * 1000;
      const startTime = new Date(ride.start_date ?? "").getTime();
      return new Date(startTime + fraction * movingTimeMs);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// fetchPprDawnRiderIds — riders who pass through any PPR intercept at the expected time
// ---------------------------------------------------------------------------
export interface PprDawnResult {
  /** User IDs of riders who qualify */
  riderIds: string[];
  /** Map of userId → number of qualifying PPR rides */
  rideCounts: Record<string, number>;
  /** Qualifying PPR ride IDs (from the rides table) */
  rideIds: string[];
}

export const fetchPprDawnRiderIds = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      dateFrom?: string;
      dateTo?: string;
      routeCategories?: string[];
    }) => input,
  )
  .handler(async ({ data }): Promise<PprDawnResult> => {
    const supabase = createAnonClient();

    // Validate date params if provided
    const dateFrom =
      data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null;
    const dateTo =
      data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;

    // Validate route categories if provided
    const routeCategories =
      data.routeCategories?.filter((c) => VALID_ROUTE_CATEGORIES.has(c)) ?? [];

    const { data: rides, error } = await supabase
      .from("ppr_dawn_rides")
      .select("*");

    if (error) {
      console.error("[leaderboard] Failed to fetch PPR dawn rides:", error);
      throw new Error(`Failed to fetch PPR dawn rides: ${error.message}`);
    }
    if (!rides || rides.length === 0)
      return { riderIds: [], rideCounts: {}, rideIds: [] };

    // Filter by date range in JS using the ride's local date.
    // start_date is a UTC timestamptz — we convert to the ride's local timezone
    // to get the correct YYYY-MM-DD date for comparison.
    let filteredByDate = rides;
    if (dateFrom || dateTo) {
      filteredByDate = rides.filter((ride) => {
        const tz = extractTimezone(ride.timezone);
        // en-CA locale gives YYYY-MM-DD format
        const localDate = new Date(ride.start_date ?? "").toLocaleDateString(
          "en-CA",
          { timeZone: tz },
        );
        if (dateFrom && localDate < dateFrom) return false;
        if (dateTo && localDate > dateTo) return false;
        return true;
      });
    }
    if (filteredByDate.length === 0)
      return { riderIds: [], rideCounts: {}, rideIds: [] };

    // First pass: find all qualifying PPR rides by intercept timing
    const qualifyingRideIds: string[] = [];
    const qualifyingRideMap = new Map<string, string>(); // ride_id → user_id

    for (const ride of filteredByDate) {
      for (const intercept of PPR_INTERCEPTS) {
        const arrivalTime = estimateInterceptArrival(
          ride as PprDawnRide,
          intercept,
        );
        if (!arrivalTime) continue;

        const tz = extractTimezone(ride.timezone);
        const localTimeStr = arrivalTime.toLocaleString("en-US", {
          timeZone: tz,
          hour12: false,
        });
        const timeParts = localTimeStr.split(", ")[1]?.split(":") ?? [];
        const localHour = parseInt(timeParts[0] ?? "0", 10);
        const localMin = parseInt(timeParts[1] ?? "0", 10);
        const localMinutes = localHour * 60 + localMin;

        if (
          localMinutes >= intercept.targetMinutes - 10 &&
          localMinutes <= intercept.targetMinutes + 10
        ) {
          qualifyingRideIds.push(ride.ride_id ?? "");
          qualifyingRideMap.set(ride.ride_id ?? "", ride.user_id ?? "");
          break;
        }
      }
    }

    if (qualifyingRideIds.length === 0)
      return { riderIds: [], rideCounts: {}, rideIds: [] };

    // Second pass: if route filters are active, look up route_category for
    // qualifying rides from the rides table and exclude non-matching rides
    let filteredRideIds = qualifyingRideIds;
    if (routeCategories.length > 0) {
      const { data: rideRoutes, error: routeError } = await supabase
        .from("rides")
        .select("id, route_category")
        .in("id", qualifyingRideIds);

      if (routeError) {
        console.error(
          "[leaderboard] Failed to fetch route categories for PPR rides:",
          routeError,
        );
        // Fall back to unfiltered results rather than failing
      } else if (rideRoutes) {
        const routeSet = new Set(routeCategories);
        const matchingIds = new Set(
          rideRoutes
            .filter((r) => r.route_category && routeSet.has(r.route_category))
            .map((r) => r.id),
        );
        filteredRideIds = qualifyingRideIds.filter((id) => matchingIds.has(id));
      }
    }

    // Build final results from filtered ride IDs
    const qualifyingUserIds = new Set<string>();
    const rideCounts: Record<string, number> = {};

    for (const rideId of filteredRideIds) {
      const userId = qualifyingRideMap.get(rideId);
      if (!userId) continue;
      qualifyingUserIds.add(userId);
      rideCounts[userId] = (rideCounts[userId] ?? 0) + 1;
    }

    return {
      riderIds: Array.from(qualifyingUserIds),
      rideCounts,
      rideIds: filteredRideIds,
    };
  });

/** Extract IANA timezone from Strava's format "(GMT-08:00) America/Los_Angeles" */
function extractTimezone(tz: string | null | undefined): string {
  if (!tz) return "America/Los_Angeles";
  // Strava format: "(GMT-08:00) America/Los_Angeles"
  const match = tz.match(/\)\s*(.+)$/);
  return match?.[1]?.trim() || "America/Los_Angeles";
}

// ---------------------------------------------------------------------------
// fetchRiderGrowthData — monthly ride counts per rider for growth chart
// ---------------------------------------------------------------------------
export const fetchRiderGrowthData = createServerFn({ method: "GET" }).handler(
  async (): Promise<MonthlyRideStat[]> => {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from("monthly_ride_stats")
      .select("user_id, month, route_category, ride_count")
      .not("route_category", "is", null)
      .order("month", { ascending: true });
    if (error) {
      console.error("[leaderboard] Failed to fetch growth data:", error);
      throw new Error(`Failed to fetch growth data: ${error.message}`);
    }
    return (data ?? []) as MonthlyRideStat[];
  },
);

// ---------------------------------------------------------------------------
// DailyRideStat — lightweight per-ride record for daily-granularity charts
// ---------------------------------------------------------------------------
export interface DailyRideStat {
  user_id: string;
  ride_date: string;
  route_category: RouteCategory | null;
}

// ---------------------------------------------------------------------------
// fetchDailyGrowthData — per-ride date data for fine-grained chart rendering
// ---------------------------------------------------------------------------
export const fetchDailyGrowthData = createServerFn({ method: "GET" }).handler(
  async (): Promise<DailyRideStat[]> => {
    const supabase = createAnonClient();
    // Paginate to work around Supabase max_rows (1000) truncation
    const PAGE_SIZE = 1000;
    const allRows: DailyRideStat[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: pageError } = await supabase
        .from("rides")
        .select("user_id, ride_date, route_category")
        .not("route_category", "is", null)
        .range(offset, offset + PAGE_SIZE - 1)
        .order("ride_date", { ascending: true });

      if (pageError) {
        console.error(
          "[leaderboard] Failed to fetch daily growth data:",
          pageError,
        );
        throw new Error(
          `Failed to fetch daily growth data: ${pageError.message}`,
        );
      }

      if (!page || page.length === 0) {
        hasMore = false;
      } else {
        allRows.push(...(page as DailyRideStat[]));
        offset += page.length;
        if (page.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    }
    console.log(
      `[leaderboard] Paginated fetch (dailyGrowth): ${allRows.length} total rows`,
    );
    return allRows;
  },
);

// ---------------------------------------------------------------------------
// fetchRouteSpeedLeaderboard — speed rankings per route category
// ---------------------------------------------------------------------------
export const fetchRouteSpeedLeaderboard = createServerFn({ method: "GET" })
  .inputValidator((input: { routeCategory: string }) => {
    const valid = [
      "bayway",
      "skyline",
      "hmbw",
      "royale",
      "fleaway",
      "mebw",
      "febw",
    ];
    if (!valid.includes(input.routeCategory)) {
      throw new Error(`Invalid route category: ${input.routeCategory}`);
    }
    return input as { routeCategory: RouteCategory };
  })
  .handler(async ({ data }): Promise<RouteSpeedEntry[]> => {
    const supabase = createAnonClient();
    const { data: entries, error } = await supabase
      .from("route_speed_leaderboard")
      .select("*")
      .eq("route_category", data.routeCategory)
      .order("avg_speed_mps", { ascending: false });
    if (error) {
      console.error(
        "[leaderboard] Failed to fetch route speed leaderboard:",
        error,
      );
      throw new Error(
        `Failed to fetch route speed leaderboard: ${error.message}`,
      );
    }
    return (entries ?? []) as RouteSpeedEntry[];
  });

// ---------------------------------------------------------------------------
// fetchCommunityBreakdown — aggregate SF2G vs non-SF2G distance + elevation
// ---------------------------------------------------------------------------

export interface CommunityBreakdown {
  sf2g_distance_meters: number;
  other_distance_meters: number;
  total_distance_meters: number;
  sf2g_elevation_meters: number;
  other_elevation_meters: number;
  total_elevation_meters: number;
  sf2g_ride_count: number;
  other_ride_count: number;
  total_ride_count: number;
}

export const fetchCommunityBreakdown = createServerFn({
  method: "GET",
}).handler(async (): Promise<CommunityBreakdown> => {
  const supabase = createAnonClient();

  // Fetch SF2G commute totals (bayway + skyline + hmbw + royale)
  // Paginate to work around Supabase max_rows (1000) truncation
  type BreakdownRow = {
    distance_meters: number | null;
    elevation_gain_meters: number | null;
  };
  const PAGE_SIZE_BD = 1000;

  const allSf2gRows: BreakdownRow[] = [];
  let sf2gOffset = 0;
  let sf2gHasMore = true;

  while (sf2gHasMore) {
    const { data: page, error: pageError } = await supabase
      .from("rides")
      .select("distance_meters, elevation_gain_meters")
      .in("route_category", [
        "bayway",
        "skyline",
        "hmbw",
        "royale",
        "fleaway",
        "mebw",
        "febw",
      ])
      .range(sf2gOffset, sf2gOffset + PAGE_SIZE_BD - 1)
      .order("ride_date", { ascending: true });

    if (pageError) {
      console.error("[leaderboard] Failed to fetch SF2G rides:", pageError);
      throw new Error(`Failed to fetch SF2G rides: ${pageError.message}`);
    }

    if (!page || page.length === 0) {
      sf2gHasMore = false;
    } else {
      allSf2gRows.push(...(page as BreakdownRow[]));
      sf2gOffset += page.length;
      if (page.length < PAGE_SIZE_BD) {
        sf2gHasMore = false;
      }
    }
  }
  console.log(
    `[leaderboard] Paginated fetch (sf2gBreakdown): ${allSf2gRows.length} total rows`,
  );
  const sf2gData = allSf2gRows;

  // Fetch "other" ride totals
  // Paginate to work around Supabase max_rows (1000) truncation
  const allOtherRows: BreakdownRow[] = [];
  let otherOffset = 0;
  let otherHasMore = true;

  while (otherHasMore) {
    const { data: page, error: pageError } = await supabase
      .from("rides")
      .select("distance_meters, elevation_gain_meters")
      .eq("route_category", "other")
      .range(otherOffset, otherOffset + PAGE_SIZE_BD - 1)
      .order("ride_date", { ascending: true });

    if (pageError) {
      console.error("[leaderboard] Failed to fetch other rides:", pageError);
      throw new Error(`Failed to fetch other rides: ${pageError.message}`);
    }

    if (!page || page.length === 0) {
      otherHasMore = false;
    } else {
      allOtherRows.push(...(page as BreakdownRow[]));
      otherOffset += page.length;
      if (page.length < PAGE_SIZE_BD) {
        otherHasMore = false;
      }
    }
  }
  console.log(
    `[leaderboard] Paginated fetch (otherBreakdown): ${allOtherRows.length} total rows`,
  );
  const otherData = allOtherRows;

  const sf2gRides = sf2gData;
  const otherRides = otherData;

  const sf2gDistance = sf2gRides.reduce(
    (sum, r) => sum + (r.distance_meters ?? 0),
    0,
  );
  const sf2gElevation = sf2gRides.reduce(
    (sum, r) => sum + (r.elevation_gain_meters ?? 0),
    0,
  );
  const otherDistance = otherRides.reduce(
    (sum, r) => sum + (r.distance_meters ?? 0),
    0,
  );
  const otherElevation = otherRides.reduce(
    (sum, r) => sum + (r.elevation_gain_meters ?? 0),
    0,
  );

  return {
    sf2g_distance_meters: sf2gDistance,
    other_distance_meters: otherDistance,
    total_distance_meters: sf2gDistance + otherDistance,
    sf2g_elevation_meters: sf2gElevation,
    other_elevation_meters: otherElevation,
    total_elevation_meters: sf2gElevation + otherElevation,
    sf2g_ride_count: sf2gRides.length,
    other_ride_count: otherRides.length,
    total_ride_count: sf2gRides.length + otherRides.length,
  };
});

// ---------------------------------------------------------------------------
// fetchCompanyRiderIds — rider IDs who have rides ending at a specific company
// ---------------------------------------------------------------------------
const VALID_COMPANIES = new Set([
  "netflix",
  "google",
  "apple",
  "meta",
  "nvidia",
  "stanford",
  "tesla",
]);

export const fetchCompanyRiderIds = createServerFn({ method: "GET" })
  .inputValidator((input: { company: string }) => {
    if (!VALID_COMPANIES.has(input.company)) {
      throw new Error(`Invalid company: ${input.company}`);
    }
    return input;
  })
  .handler(async ({ data }): Promise<string[]> => {
    const supabase = createAnonClient();

    // Query rides table directly for distinct user_ids with this destination_company
    // Paginate to work around Supabase max_rows (1000) truncation
    const PAGE_SIZE = 1000;
    const allCompanyRows: { user_id: string }[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error: pageError } = await supabase
        .from("rides")
        .select("user_id")
        .eq("destination_company", data.company as DestinationCompany)
        .not("route_category", "is", null)
        .range(offset, offset + PAGE_SIZE - 1)
        .order("user_id", { ascending: true });

      if (pageError) {
        console.error(
          "[leaderboard] Failed to fetch company rider IDs:",
          pageError,
        );
        throw new Error(
          `Failed to fetch company rider IDs: ${pageError.message}`,
        );
      }

      if (!page || page.length === 0) {
        hasMore = false;
      } else {
        allCompanyRows.push(...(page as { user_id: string }[]));
        offset += page.length;
        if (page.length < PAGE_SIZE) {
          hasMore = false;
        }
      }
    }
    console.log(
      `[leaderboard] Paginated fetch (companyRiderIds): ${allCompanyRows.length} total rows`,
    );
    const rows = allCompanyRows;

    // Deduplicate user IDs
    const uniqueIds = new Set(rows.map((r: { user_id: string }) => r.user_id));
    return Array.from(uniqueIds);
  });
