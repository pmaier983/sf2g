/**
 * All-Time leaderboard server function.
 *
 * Computes the maximum number of SF2G rides per rider within a rolling
 * window of configurable duration (days). Uses a sliding-window approach
 * over each rider's sorted ride dates.
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient } from "../lib/supabase";
import type { RouteCategory, DestinationCompany } from "../lib/database.types";
import { getCommuteDirection } from "../lib/route-classifier";

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
interface RidesCacheEntry {
  timestamp: number;
  ridesByUser: Map<string, string[]>;
}
const ridesCache = new Map<string, RidesCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// fetchAllTimeLeaderboard — rolling-window max rides per rider
// ---------------------------------------------------------------------------
export const fetchAllTimeLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(
    (input: {
      durationDays: number;
      routes?: RouteCategory[];
      excludeWeekends?: boolean;
      dateFrom?: string;
      dateTo?: string;
      includeOther?: boolean;
      company?: string;
      reverse?: boolean;
    }) => input,
  )
  .handler(async ({ data }): Promise<AllTimeEntry[]> => {
    const supabase = createAnonClient();

    // Validate durationDays (must be positive integer, cap at 3650 = ~10 years)
    const durationDays = Math.max(
      1,
      Math.min(Math.round(data.durationDays), 3650),
    );

    // Cache key based on all filter parameters EXCEPT durationDays
    const cacheKey = JSON.stringify({
      routes: data.routes?.slice().sort(),
      excludeWeekends: !!data.excludeWeekends,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      includeOther: !!data.includeOther,
      company: data.company,
      reverse: !!data.reverse,
    });

    let ridesByUser: Map<string, string[]>;
    const cached = ridesCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      ridesByUser = cached.ridesByUser;
    } else {
      // Build the rides query generator
      const selectFields = data.reverse
        ? "user_id, ride_date, start_latlng, end_latlng"
        : "user_id, ride_date";

      const VALID_COMPANIES = new Set([
        "netflix",
        "google",
        "apple",
        "meta",
        "nvidia",
        "stanford",
        "tesla",
      ]);

      const dateFrom =
        data.dateFrom && isValidDateString(data.dateFrom)
          ? data.dateFrom
          : null;
      const dateTo =
        data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;

      function createRidesQuery(countOptions?: { count: "exact" }) {
        let query = countOptions
          ? supabase.from("rides").select(selectFields, countOptions)
          : supabase.from("rides").select(selectFields);

        query = query.not("route_category", "is", null);

        // Apply route filter
        if (data.routes && data.routes.length > 0) {
          const validCats = data.routes.filter((c) =>
            VALID_ROUTE_CATEGORIES.has(c),
          );
          if (validCats.length > 0) {
            query = query.in("route_category", validCats);
          }
        } else if (!data.includeOther) {
          // Default: exclude 'other' routes unless includeOther is true
          query = query.neq("route_category", "other");
        }

        // Apply company filter
        if (data.company && VALID_COMPANIES.has(data.company)) {
          query = query.eq(
            "destination_company",
            data.company as DestinationCompany,
          );
        }

        if (dateFrom) query = query.gte("ride_date", dateFrom);
        if (dateTo) query = query.lte("ride_date", dateTo);

        return query.order("ride_date", { ascending: true });
      }

      type AllTimeRide = {
        user_id: string;
        ride_date: string;
        start_latlng?: [number, number] | null;
        end_latlng?: [number, number] | null;
      };

      const PAGE_SIZE = 1000;
      // Fetch first page and exact count in a single request
      const {
        data: firstPage,
        count,
        error: firstError,
      } = await createRidesQuery({ count: "exact" }).range(0, PAGE_SIZE - 1);

      if (firstError) {
        console.error("[alltime] Failed to fetch rides:", firstError);
        throw new Error(`Failed to fetch rides: ${firstError.message}`);
      }

      const allRows: AllTimeRide[] = [
        ...((firstPage ?? []) as unknown as AllTimeRide[]),
      ];
      const totalCount = count ?? allRows.length;

      // Fetch all remaining pages in parallel
      if (totalCount > PAGE_SIZE) {
        const pagePromises = [];
        for (let offset = PAGE_SIZE; offset < totalCount; offset += PAGE_SIZE) {
          pagePromises.push(
            createRidesQuery().range(offset, offset + PAGE_SIZE - 1),
          );
        }
        const results = await Promise.all(pagePromises);
        for (const res of results) {
          if (res.error) {
            console.error("[alltime] Page fetch error:", res.error);
          } else if (res.data) {
            allRows.push(...(res.data as unknown as AllTimeRide[]));
          }
        }
      }

      const rides = allRows;
      if (!rides.length) return [];

      // Filter by commute direction when reverse filter is active (G2SF = Peninsula → SF)
      const directionFilteredRides = data.reverse
        ? rides.filter((r) => {
            const startLatLng = r.start_latlng as [number, number] | null;
            const endLatLng = r.end_latlng as [number, number] | null;
            return getCommuteDirection(startLatLng, endLatLng) === "g2sf";
          })
        : rides;

      if (directionFilteredRides.length === 0) return [];

      // Group rides by user, optionally excluding weekends
      ridesByUser = new Map<string, string[]>();
      for (const ride of directionFilteredRides) {
        if (data.excludeWeekends) {
          const day = new Date(ride.ride_date).getUTCDay();
          if (day === 0 || day === 6) continue;
        }
        const dates = ridesByUser.get(ride.user_id) || [];
        dates.push(ride.ride_date);
        ridesByUser.set(ride.user_id, dates);
      }

      ridesCache.set(cacheKey, {
        timestamp: Date.now(),
        ridesByUser,
      });
    }

    // For each user, find the sliding window with the most rides using O(N) two-pointer scan
    const results: Array<{
      userId: string;
      maxRides: number;
      windowStart: string;
      windowEnd: string;
      totalRides: number;
      rideDatesInWindow: string[];
    }> = [];

    const windowMs = durationDays * 86_400_000;

    for (const [userId, dates] of ridesByUser) {
      const sortedDates = dates.sort();
      const timestamps = sortedDates.map((d) => Date.parse(d));
      let maxRides = 0;
      let bestStart = "";
      let bestEnd = "";
      let bestDates: string[] = [];

      let right = 0;
      for (let left = 0; left < timestamps.length; left++) {
        if (right < left) right = left;
        const windowEndMs = timestamps[left] + windowMs;

        while (right < timestamps.length && timestamps[right] <= windowEndMs) {
          right++;
        }

        const count = right - left;
        if (count > maxRides) {
          maxRides = count;
          bestStart = sortedDates[left];
          bestEnd = sortedDates[right - 1];
          bestDates = sortedDates.slice(left, right);
        }
      }

      results.push({
        userId,
        maxRides,
        windowStart: bestStart,
        windowEnd: bestEnd,
        totalRides: sortedDates.length,
        rideDatesInWindow: bestDates,
      });
    }

    // Sort by maxRides descending, then totalRides as tiebreaker
    results.sort(
      (a, b) => b.maxRides - a.maxRides || b.totalRides - a.totalRides,
    );

    // Fetch user details for top results (cap at 200)
    const topResults = results.slice(0, 200);
    const userIds = topResults.map((r) => r.userId);

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, display_name, avatar_url")
      .in("id", userIds);

    if (usersError) {
      console.error("[alltime] Failed to fetch users:", usersError);
    }

    const userMap = new Map((users ?? []).map((u) => [u.id, u]));

    return topResults.map((r) => ({
      userId: r.userId,
      displayName: userMap.get(r.userId)?.display_name || "Unknown",
      avatarUrl: userMap.get(r.userId)?.avatar_url || null,
      maxRidesInWindow: r.maxRides,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      totalSf2gRides: r.totalRides,
      rideDatesInWindow: r.rideDatesInWindow,
    }));
  });
