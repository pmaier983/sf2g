/**
 * All-Time leaderboard server function.
 *
 * Computes the maximum number of SF2G rides per rider within a rolling
 * window of configurable duration (days). Uses a sliding-window approach
 * over each rider's sorted ride dates.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type { Json, RouteCategory } from "../lib/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AllTimeEntry {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  maxRidesInWindow: number;
  windowStart: string; // ISO date
  windowEnd: string; // ISO date
  totalSf2gRides: number;
  rideDatesInWindow: string[];
}

// ---------------------------------------------------------------------------
// Route-category allow-list (mirrors leaderboard.ts)
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

/** Validate ISO date string format (YYYY-MM-DD) */
function isValidDateString(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
}

// ---------------------------------------------------------------------------
// In-memory cache for ride dates to ensure instant duration toggling (1w / 1m / 1y)
// ---------------------------------------------------------------------------
interface UserRide {
  date: string;
  timeMs: number;
}

interface RidesCacheEntry {
  timestamp: number;
  ridesByUser: Map<string, UserRide[]>;
}
const ridesCache = new Map<string, RidesCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// fetchAllTimeLeaderboard — rolling-window max rides per rider
// ---------------------------------------------------------------------------
const fetchAllTimeLeaderboardInput = (input: {
  durationDays: number;
  routes?: RouteCategory[];
  excludeWeekends?: boolean;
  dateFrom?: string;
  dateTo?: string;
  includeOther?: boolean;
  company?: string;
  reverse?: boolean;
  /** Only PPR-at-dawn rides */
  ppr?: boolean;
}) => input;

export async function fetchAllTimeLeaderboardImpl(
  data: ReturnType<typeof fetchAllTimeLeaderboardInput>,
): Promise<AllTimeEntry[]> {
  const supabase = createAnonClient();
  // Sliding window computed in SQL (get_alltime_leaderboard, migration 038).
  const { data: rows, error } = await supabase.rpc("get_alltime_leaderboard", {
    q: {
      duration_days: data.durationDays,
      routes: (data.routes ?? []).filter((c) => VALID_ROUTE_CATEGORIES.has(c)),
      include_other: !!data.includeOther,
      exclude_weekends: !!data.excludeWeekends,
      date_from:
        data.dateFrom && isValidDateString(data.dateFrom)
          ? data.dateFrom
          : null,
      date_to:
        data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null,
      company: data.company ?? null,
      reverse: !!data.reverse,
      ppr: !!data.ppr,
    } as Json,
  });
  if (error) {
    console.error("[alltime] get_alltime_leaderboard failed:", error);
    throw new Error(`Failed to fetch all-time leaderboard: ${error.message}`);
  }
  return (rows ?? []) as unknown as AllTimeEntry[];
}

export const fetchAllTimeLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(fetchAllTimeLeaderboardInput)
  .handler(({ data }) => fetchAllTimeLeaderboardImpl(data));
