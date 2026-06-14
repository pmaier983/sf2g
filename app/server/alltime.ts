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

    // Build the rides query
    let query = supabase
      .from("rides")
      .select(
        "user_id, ride_date, route_category, destination_company, start_latlng, end_latlng",
      )
      .not("route_category", "is", null);

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
    const VALID_COMPANIES = new Set([
      "netflix",
      "google",
      "apple",
      "meta",
      "nvidia",
      "stanford",
      "tesla",
    ]);
    if (data.company && VALID_COMPANIES.has(data.company)) {
      query = query.eq(
        "destination_company",
        data.company as DestinationCompany,
      );
    }

    // Validate and apply date filters
    const dateFrom =
      data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null;
    const dateTo =
      data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null;
    if (dateFrom) query = query.gte("ride_date", dateFrom);
    if (dateTo) query = query.lte("ride_date", dateTo);

    const { data: rides, error } = await query
      .order("ride_date", { ascending: true })
      .limit(1000000);
    if (error) {
      console.error("[alltime] Failed to fetch rides:", error);
      throw new Error(`Failed to fetch rides: ${error.message}`);
    }
    if (!rides?.length) return [];

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
    const ridesByUser = new Map<string, string[]>();
    for (const ride of directionFilteredRides) {
      if (data.excludeWeekends) {
        const day = new Date(ride.ride_date).getUTCDay();
        if (day === 0 || day === 6) continue;
      }
      const dates = ridesByUser.get(ride.user_id) || [];
      dates.push(ride.ride_date);
      ridesByUser.set(ride.user_id, dates);
    }

    // For each user, find the sliding window with the most rides
    const results: Array<{
      userId: string;
      maxRides: number;
      windowStart: string;
      windowEnd: string;
      totalRides: number;
      rideDatesInWindow: string[];
    }> = [];

    for (const [userId, dates] of ridesByUser) {
      const sortedDates = dates.sort();
      let maxRides = 0;
      let bestStart = "";
      let bestEnd = "";
      let bestDates: string[] = [];

      for (let i = 0; i < sortedDates.length; i++) {
        const windowStart = new Date(sortedDates[i]);
        const windowEnd = new Date(windowStart);
        windowEnd.setDate(windowEnd.getDate() + durationDays);

        // Count rides in this window
        let count = 0;
        for (let j = i; j < sortedDates.length; j++) {
          if (new Date(sortedDates[j]) < windowEnd) {
            count++;
          } else break;
        }

        if (count > maxRides) {
          maxRides = count;
          bestStart = sortedDates[i];
          bestEnd =
            sortedDates[Math.min(i + count - 1, sortedDates.length - 1)];
          bestDates = sortedDates.slice(i, i + count);
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
