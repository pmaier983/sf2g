/**
 * Ride server functions.
 *
 * - `fetchUserRides` — queries rides for a specific user with optional filters
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import { withPerf } from "../lib/perf";
import type {
  Json,
  ProfileRide,
  Ride,
  RouteCategory,
  DestinationCompany,
  RideLeaderboardEntry,
  RidesLeaderboardResponse,
} from "../lib/database.types";

// ---------------------------------------------------------------------------
// fetchUserRides — filtered, paginated ride query
// ---------------------------------------------------------------------------
const fetchUserRidesInput = (input: {
  userId: string;
  limit?: number;
  offset?: number;
  routeCategory?: RouteCategory;
  includeAllRides?: boolean;
  includeHidden?: boolean;
  search?: string;
  routeCategories?: string[];
}) => input;

export async function fetchUserRidesImpl(
  data: ReturnType<typeof fetchUserRidesInput>,
): Promise<Ride[]> {
  const supabase = createAnonClient();
  console.log(
    `[rides] Fetching rides for user ${data.userId}, routeCategory: ${data.routeCategory ?? "all"}, includeAll: ${data.includeAllRides ?? false}`,
  );

  let query = supabase
    .from("rides")
    .select("*", { count: "exact" })
    .eq("user_id", data.userId)
    .order("ride_date", { ascending: false })
    .order("id", { ascending: true }); // unique tiebreaker: stable paging

  // Optional route category filter
  if (data.routeCategory) {
    query = query.eq("route_category", data.routeCategory);
  } else if (data.routeCategories && data.routeCategories.length > 0) {
    query = query.in("route_category", data.routeCategories);
  } else if (!data.includeAllRides) {
    // Default: only return SF2G rides (exclude rides with null route_category)
    query = query.not("route_category", "is", null);
  }

  // Only filter out hidden rides when includeHidden is not set
  if (!data.includeHidden) {
    query = query.or("is_hidden.eq.false,is_hidden.is.null");
  }

  // Server-side search by ride name
  if (data.search) {
    const sanitized = data.search.replace(/[%_\\]/g, "\\$&");
    query = query.ilike("name", `%${sanitized}%`);
  }

  // Pagination
  const limit = data.limit ?? 50;
  const offset = data.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data: rides, error } = await query;

  if (error) {
    console.error(
      `[rides] Error fetching rides for user ${data.userId}:`,
      error.message,
    );
    throw new Error(`Failed to fetch rides: ${error.message}`);
  }

  console.log(
    `[rides] Found ${rides?.length ?? 0} rides for user ${data.userId}`,
  );
  return rides ?? [];
}

export const fetchUserRides = createServerFn({ method: "GET" })
  .inputValidator(fetchUserRidesInput)
  .handler(({ data }) => fetchUserRidesImpl(data));

// ---------------------------------------------------------------------------
// Allowed sort columns (allow-list to prevent arbitrary column access)
// ---------------------------------------------------------------------------
const VALID_SORT_COLUMNS = new Set([
  "ride_date",
  "average_speed_mps",
  "distance_meters",
  "elevation_gain_meters",
  "moving_time_seconds",
  "name",

  "route_category",
  "display_name",
  "average_watts",
  "max_watts",
  "average_heartrate",
  "max_heartrate",
  "kilojoules",
]);

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

/**
 * Escape special LIKE/ILIKE pattern characters to prevent pattern injection.
 * Escapes `%`, `_`, and `\` in user-supplied search strings.
 */
function sanitizeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// fetchProfileRides — a rider's visible classified rides, lean fields only,
// as one jsonb value (get_profile_rides, migration 039). Replaces
// fetchUserRides({ limit: 10000 }), which PostgREST capped at 1000 rows and
// which carried every polyline through the Worker.
// ---------------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchProfileRidesImpl(data: {
  userId: string;
}): Promise<ProfileRide[]> {
  if (!UUID_RE.test(data.userId)) return [];
  const supabase = createAnonClient();
  const { data: rides, error } = await supabase.rpc("get_profile_rides", {
    p_user_id: data.userId,
  });
  if (error) {
    throw new Error(`Failed to fetch profile rides: ${error.message}`);
  }
  return (rides ?? []) as unknown as ProfileRide[];
}

export const fetchProfileRides = createServerFn({ method: "GET" })
  .inputValidator((input: { userId: string }) => input)
  .handler(
    withPerf("fetchProfileRides", ({ data }) => fetchProfileRidesImpl(data)),
  );

// ---------------------------------------------------------------------------
// fetchRidesLeaderboard — cross-user rides query with filters & pagination
// ---------------------------------------------------------------------------
const fetchRidesLeaderboardInput = (input: {
  userId?: string;
  routeCategories?: string[];
  company?: string;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  dateFrom?: string; // ISO date string e.g. '2024-01-01'
  dateTo?: string; // ISO date string
  includeOther?: boolean;
  excludeWeekends?: boolean;
  /** Only PPR-at-dawn rides (rides.is_ppr_dawn) */
  ppr?: boolean;
  reverse?: boolean;
}) => input;

export async function fetchRidesLeaderboardImpl(
  data: ReturnType<typeof fetchRidesLeaderboardInput>,
): Promise<RidesLeaderboardResponse> {
  const supabase = createAnonClient();
  const page = Math.max(1, data.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, data.pageSize ?? 200));

  // One SQL call: filters, sort and paging all happen in get_rides
  // (migration 038), so pages are full and totalCount matches the filters.
  const { data: rows, error } = await supabase.rpc("get_rides", {
    q: {
      user_id: data.userId ?? null,
      routes: (data.routeCategories ?? []).filter((c) =>
        VALID_ROUTE_CATEGORIES.has(c),
      ),
      include_other: !!data.includeOther,
      company: data.company ?? null,
      search: data.search ?? null,
      date_from: data.dateFrom ?? null,
      date_to: data.dateTo ?? null,
      exclude_weekends: data.excludeWeekends ?? false,
      ppr: !!data.ppr,
      reverse: !!data.reverse,
      sort:
        data.sortBy && VALID_SORT_COLUMNS.has(data.sortBy)
          ? data.sortBy
          : "ride_date",
      dir: data.sortDir ?? "desc",
      page,
      page_size: pageSize,
    } as Json,
  });
  if (error) {
    console.error("[rides-leaderboard] get_rides failed:", error);
    throw new Error(`Failed to fetch rides leaderboard: ${error.message}`);
  }

  const list = rows ?? [];
  const rides: RideLeaderboardEntry[] = list.map(
    ({ total_count: _total, ...r }) => ({
      ...r,
      route_category: r.route_category as RouteCategory | null,
      destination_company:
        r.destination_company as RideLeaderboardEntry["destination_company"],
      distance_meters: r.distance_meters ?? 0,
      elevation_gain_meters: r.elevation_gain_meters ?? 0,
      moving_time_seconds: r.moving_time_seconds ?? 0,
      start_latlng: r.start_latlng as [number, number] | null,
      end_latlng: r.end_latlng as [number, number] | null,
      tailwind_component_ms: null,
    }),
  );
  return {
    rides,
    totalCount: list.length > 0 ? Number(list[0].total_count) : 0,
    page,
    pageSize,
  };
}

export const fetchRidesLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(fetchRidesLeaderboardInput)
  .handler(({ data }) => fetchRidesLeaderboardImpl(data));

// ---------------------------------------------------------------------------
// fetchCommunityStartHours — average start hour per rider for percentile comparison
// ---------------------------------------------------------------------------

export interface CommunityStartHoursResponse {
  /** Array of average start hours (fractional, e.g. 6.5 = 6:30 AM), one per rider */
  averageHours: number[];
}

export async function fetchCommunityStartHoursImpl(): Promise<CommunityStartHoursResponse> {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_community_start_hours");
  if (error) {
    throw new Error(`Failed to fetch community start hours: ${error.message}`);
  }
  return data as unknown as CommunityStartHoursResponse;
}

export const fetchCommunityStartHours = createServerFn({
  method: "GET",
}).handler(() => fetchCommunityStartHoursImpl());

// ---------------------------------------------------------------------------
// fetchCommunityStreaks — best weekly streak per rider for percentile comparison
// ---------------------------------------------------------------------------

export interface CommunityStreaksResponse {
  /** Array of best weekly streaks, one per rider */
  bestStreaks: number[];
}

export async function fetchCommunityStreaksImpl(): Promise<CommunityStreaksResponse> {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_community_streaks");
  if (error) {
    throw new Error(`Failed to fetch community streaks: ${error.message}`);
  }
  return data as unknown as CommunityStreaksResponse;
}

export const fetchCommunityStreaks = createServerFn({ method: "GET" }).handler(
  () => fetchCommunityStreaksImpl(),
);
