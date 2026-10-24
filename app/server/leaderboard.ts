/**
 * Leaderboard server functions.
 *
 * - `fetchLeaderboard` — Riders table via get_leaderboard (one SQL call)
 * - `fetchRiderGrowth` — cumulative-chart buckets for selected riders
 * - `fetchCommunityBreakdown` — aggregate SF2G vs other distance/elevation
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type {
  Json,
  LeaderboardEntry,
  RouteCategory,
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
// fetchRiderGrowth — chart buckets for the riders on the chart, filtered
// exactly like the table (get_rider_growth, migration 038). Replaces the old
// fetchRiderGrowthData / fetchDailyGrowthData, which shipped every monthly row
// and every ride to the browser and ignored most filters.
// ---------------------------------------------------------------------------
export type GrowthGranularity = "daily" | "weekly" | "monthly";

export interface GrowthBucket {
  user_id: string;
  /** Bucket start: the day, the Monday of the week, or the 1st of the month */
  bucket: string;
  count: number;
}

export type RiderGrowthInput = LeaderboardQueryInput & {
  riderIds: string[];
  granularity: GrowthGranularity;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchRiderGrowthImpl(
  input: RiderGrowthInput,
): Promise<GrowthBucket[]> {
  const riderIds = (input.riderIds ?? [])
    .filter((id) => UUID_RE.test(id))
    .slice(0, 50);
  if (riderIds.length === 0) return [];
  const granularity: GrowthGranularity = [
    "daily",
    "weekly",
    "monthly",
  ].includes(input.granularity)
    ? input.granularity
    : "monthly";

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_rider_growth", {
    q: toLeaderboardSqlParams(parseLeaderboardQuery(input)) as Json,
    rider_ids: riderIds,
    granularity,
  });
  if (error) {
    throw new Error(`Failed to fetch growth data: ${error.message}`);
  }
  return (data ?? []) as unknown as GrowthBucket[];
}

export const fetchRiderGrowth = createServerFn({ method: "GET" })
  .inputValidator((input: RiderGrowthInput) => input)
  .handler(
    withPerf("fetchRiderGrowth", ({ data }) => fetchRiderGrowthImpl(data)),
  );

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
  const { data, error } = await supabase.rpc("get_community_breakdown");
  if (error) {
    throw new Error(`Failed to fetch community breakdown: ${error.message}`);
  }
  return data as unknown as CommunityBreakdown;
}

export const fetchCommunityBreakdown = createServerFn({
  method: "GET",
}).handler(() => fetchCommunityBreakdownImpl());
