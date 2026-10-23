/**
 * Leaderboard server functions.
 *
 * - `fetchLeaderboard` — Riders table via get_leaderboard (one SQL call)
 * - `fetchPprDawnRiderIds` — riders with PPR-at-dawn rides (rides.is_ppr_dawn)
 * - `fetchRiderGrowthData` — monthly ride counts per rider (for growth chart)
 * - `fetchRouteSpeedLeaderboard` — speed rankings per route category
 * - `fetchCommunityBreakdown` — aggregate SF2G vs other distance/elevation
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type {
  Json,
  LeaderboardEntry,
  MonthlyRideStat,
  RouteCategory,
  RouteSpeedEntry,
} from "../lib/database.types";
import { withPerf } from "../lib/perf";
import {
  parseLeaderboardQuery,
  toLeaderboardSqlParams,
  type LeaderboardQueryInput,
} from "../lib/leaderboard-query";

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
  "median_speed_mps",
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
  "median_watts",
  "avg_heartrate",
  "avg_kilojoules",
]);

/** Validate ISO date string format (YYYY-MM-DD) */
function isValidDateString(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

// ---------------------------------------------------------------------------
// fetchLeaderboard — the Riders table, computed by get_leaderboard (migration
// 037). Every filter is applied in SQL to one set of eligible rides; the
// Worker makes exactly one request and does no aggregation.
// ---------------------------------------------------------------------------
export async function fetchLeaderboardImpl(
  input: LeaderboardQueryInput,
): Promise<LeaderboardEntry[]> {
  const q = parseLeaderboardQuery(input);
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_leaderboard", {
    q: toLeaderboardSqlParams(q) as Json,
  });
  if (error) {
    console.error("[leaderboard] get_leaderboard failed:", error);
    throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  }
  return (data ?? []).map(({ total_count: _total, ...row }) => row);
}

export const fetchLeaderboard = createServerFn({ method: "GET" })
  .inputValidator((input: LeaderboardQueryInput) =>
    parseLeaderboardQuery(input),
  )
  .handler(
    withPerf("fetchLeaderboard", ({ data }) => fetchLeaderboardImpl(data)),
  );

// ---------------------------------------------------------------------------
// fetchPprDawnRiderIds — PPR-at-dawn rides per rider, from rides.is_ppr_dawn
// (computed in SQL by migration 037). Still used by the Rides and All-Time
// views until they move to SQL in phase 03b.
// ---------------------------------------------------------------------------
export interface PprDawnResult {
  /** User IDs of riders who qualify */
  riderIds: string[];
  /** Map of userId → number of qualifying PPR rides */
  rideCounts: Record<string, number>;
  /** Qualifying PPR ride IDs (from the rides table) */
  rideIds: string[];
}

const fetchPprDawnRiderIdsInput = (input: {
  dateFrom?: string;
  dateTo?: string;
  routeCategories?: string[];
}) => input;

export async function fetchPprDawnRiderIdsImpl(
  data: ReturnType<typeof fetchPprDawnRiderIdsInput>,
): Promise<PprDawnResult> {
  const supabase = createAnonClient();
  const dateFrom =
    data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null;
  const dateTo =
    data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;
  const routeCategories =
    data.routeCategories?.filter((c) => VALID_ROUTE_CATEGORIES.has(c)) ?? [];

  let query = supabase
    .from("rides")
    .select("id, user_id")
    .eq("is_ppr_dawn", true)
    .not("route_category", "is", null)
    .or("is_hidden.eq.false,is_hidden.is.null")
    .or("is_private.eq.false,is_private.is.null")
    .order("id", { ascending: true });
  if (dateFrom) query = query.gte("ride_date", dateFrom);
  if (dateTo) query = query.lte("ride_date", dateTo);
  if (routeCategories.length > 0) {
    query = query.in("route_category", routeCategories as RouteCategory[]);
  }

  // ids only — cheap even when paged
  const rows: Array<{ id: string; user_id: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await query.range(offset, offset + 999);
    if (error) {
      throw new Error(`Failed to fetch PPR dawn rides: ${error.message}`);
    }
    rows.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }

  const rideCounts: Record<string, number> = {};
  for (const r of rows)
    rideCounts[r.user_id] = (rideCounts[r.user_id] ?? 0) + 1;
  return {
    riderIds: Object.keys(rideCounts),
    rideCounts,
    rideIds: rows.map((r) => r.id),
  };
}

export const fetchPprDawnRiderIds = createServerFn({ method: "GET" })
  .inputValidator(fetchPprDawnRiderIdsInput)
  .handler(({ data }) => fetchPprDawnRiderIdsImpl(data));

// ---------------------------------------------------------------------------
// fetchRiderGrowthData — monthly ride counts per rider for growth chart
// ---------------------------------------------------------------------------
export async function fetchRiderGrowthDataImpl(): Promise<MonthlyRideStat[]> {
  const supabase = createAnonClient();
  const PAGE_SIZE = 1000;
  const allRows: MonthlyRideStat[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: page, error: pageError } = await supabase
      .from("monthly_ride_stats")
      .select("user_id, month, route_category, ride_count")
      .not("route_category", "is", null)
      .range(offset, offset + PAGE_SIZE - 1)
      .order("month", { ascending: true })
      .order("user_id", { ascending: true }) // unique tiebreaker: stable paging
      .order("route_category", { ascending: true });
    if (pageError) {
      console.error("[leaderboard] Failed to fetch growth data:", pageError);
      throw new Error(`Failed to fetch growth data: ${pageError.message}`);
    }
    if (!page || page.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...(page as MonthlyRideStat[]));
      offset += page.length;
      if (page.length < PAGE_SIZE) hasMore = false;
    }
  }
  return allRows;
}

export const fetchRiderGrowthData = createServerFn({ method: "GET" }).handler(
  () => fetchRiderGrowthDataImpl(),
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
export async function fetchDailyGrowthDataImpl(): Promise<DailyRideStat[]> {
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
      .order("ride_date", { ascending: true })
      .order("id", { ascending: true }); // unique tiebreaker: stable paging

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
}

export const fetchDailyGrowthData = createServerFn({ method: "GET" }).handler(
  () => fetchDailyGrowthDataImpl(),
);

// ---------------------------------------------------------------------------
// fetchRouteSpeedLeaderboard — speed rankings per route category
// ---------------------------------------------------------------------------
const fetchRouteSpeedLeaderboardInput = (input: { routeCategory: string }) => {
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
};

export async function fetchRouteSpeedLeaderboardImpl(
  data: ReturnType<typeof fetchRouteSpeedLeaderboardInput>,
): Promise<RouteSpeedEntry[]> {
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
}

export const fetchRouteSpeedLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(fetchRouteSpeedLeaderboardInput)
  .handler(({ data }) => fetchRouteSpeedLeaderboardImpl(data));

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

export async function fetchCommunityBreakdownImpl(): Promise<CommunityBreakdown> {
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
      .order("ride_date", { ascending: true })
      .order("id", { ascending: true }); // unique tiebreaker: stable paging

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
      .order("ride_date", { ascending: true })
      .order("id", { ascending: true }); // unique tiebreaker: stable paging

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
}

export const fetchCommunityBreakdown = createServerFn({
  method: "GET",
}).handler(() => fetchCommunityBreakdownImpl());
