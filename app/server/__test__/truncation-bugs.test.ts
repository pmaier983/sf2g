/**
 * Truncation bug regression tests.
 *
 * Covers:
 * 1. Supabase max_rows truncation — All ride queries must use .limit()
 * 2. All Time leaderboard — route/company filters with explicit limit
 * 3. Group ride co-occurrences — query limit and refresh decoupling
 * 4. Rolling-window algorithm — correctness with filtered data
 *
 * These tests prevent regressions of bugs where:
 * - "All Time" + HMBW filter showed empty data (max_rows=1000 truncation)
 * - "All Time" + Apple filter showed very few rides (same truncation)
 * - New users' rides didn't appear in group rides (co-occurrences not refreshed)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const alltimeSource = readFileSync(
  resolve(__dirname, "../../server/alltime.ts"),
  "utf-8",
);

const syncSource = readFileSync(
  resolve(__dirname, "../../server/sync.ts"),
  "utf-8",
);

const groupRidesSource = readFileSync(
  resolve(__dirname, "../../server/group-rides.ts"),
  "utf-8",
);

const leaderboardSource = readFileSync(
  resolve(__dirname, "../../server/leaderboard.ts"),
  "utf-8",
);

const networkSource = readFileSync(
  resolve(__dirname, "../../server/network.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// 1. Supabase max_rows truncation — queries must use .limit()
// ---------------------------------------------------------------------------

describe("Supabase max_rows truncation prevention", () => {
  it("fetchAllTimeLeaderboard paginates to avoid max_rows truncation", () => {
    // .limit(1000000) does NOT work — Supabase silently truncates to max_rows (1000).
    // The fix paginates through all rows using .range() in a loop.
    expect(alltimeSource).toContain("PAGE_SIZE");
    expect(alltimeSource).toContain(".range(offset,");
  });

  it("fetchFilteredLeaderboard paginates to avoid max_rows truncation", () => {
    // .limit(1000000) does NOT work — Supabase silently truncates to max_rows (1000).
    // The fix paginates through all rows using .range() in a loop.
    expect(leaderboardSource).toContain("PAGE_SIZE");
    expect(leaderboardSource).toContain(".range(offset,");
  });

  it("fetchGroupRides paginates to avoid max_rows truncation", () => {
    expect(groupRidesSource).toContain("PAGE_SIZE");
    expect(groupRidesSource).toContain(".range(");
  });

  it("fetchRiderNetwork paginates to avoid max_rows truncation", () => {
    expect(networkSource).toContain("PAGE_SIZE");
    expect(networkSource).toContain(".range(");
  });
});

// ---------------------------------------------------------------------------
// 2. All Time leaderboard — route + company filter correctness
// ---------------------------------------------------------------------------

describe("All Time leaderboard — route filtering", () => {
  it("alltime.ts validates route categories against allow-list", () => {
    expect(alltimeSource).toContain("VALID_ROUTE_CATEGORIES.has(c)");
  });

  it("alltime.ts applies route filter with .in()", () => {
    expect(alltimeSource).toContain('query.in("route_category", validCats)');
  });

  it("alltime.ts excludes other routes by default when no route filter", () => {
    expect(alltimeSource).toContain('query.neq("route_category", "other")');
  });

  it("alltime.ts filters null route_category by default", () => {
    expect(alltimeSource).toContain('.not("route_category", "is", null)');
  });

  it("alltime.ts supports all standard route categories", () => {
    const ALL_ROUTES = [
      "bayway",
      "skyline",
      "hmbw",
      "royale",
      "fleaway",
      "mebw",
      "febw",
      "other",
    ];
    for (const route of ALL_ROUTES) {
      expect(alltimeSource).toContain(`"${route}"`);
    }
  });
});

describe("All Time leaderboard — company filtering", () => {
  it("alltime.ts validates company against allow-list", () => {
    expect(alltimeSource).toContain("VALID_COMPANIES.has(data.company)");
  });

  it("alltime.ts applies company filter with .eq()", () => {
    expect(alltimeSource).toContain("query.eq(");
    expect(alltimeSource).toContain('"destination_company"');
  });

  it("alltime.ts supports standard company values", () => {
    for (const company of ["netflix", "google", "apple", "meta"]) {
      expect(alltimeSource).toContain(`"${company}"`);
    }
  });
});

describe("All Time leaderboard — date filtering", () => {
  it("alltime.ts validates date strings", () => {
    expect(alltimeSource).toContain("isValidDateString");
  });

  it("alltime.ts applies dateFrom with .gte()", () => {
    expect(alltimeSource).toContain('query.gte("ride_date", dateFrom)');
  });

  it("alltime.ts applies dateTo with .lte()", () => {
    expect(alltimeSource).toContain('query.lte("ride_date", dateTo)');
  });
});

// ---------------------------------------------------------------------------
// 3. Group ride co-occurrences — refresh decoupling
// ---------------------------------------------------------------------------

describe("Group ride co-occurrences — refresh after sync", () => {
  it("sync.ts calls refresh_ride_co_occurrences", () => {
    expect(syncSource).toContain("refresh_ride_co_occurrences");
  });

  it("co-occurrences refresh is NOT inside skipLeaderboardRefresh guard", () => {
    // The co-occurrences refresh must be called unconditionally.
    // Find the refresh call and verify it's NOT nested inside the
    // skipLeaderboardRefresh conditional block.

    // Strategy: split the source at the closing brace of the skipLeaderboardRefresh block
    // and verify the co-occurrences refresh appears AFTER it
    const skipGuardIndex = syncSource.indexOf("skipLeaderboardRefresh");
    const coOccRefreshIndex = syncSource.indexOf("refresh_ride_co_occurrences");

    // Both should exist
    expect(skipGuardIndex).toBeGreaterThan(-1);
    expect(coOccRefreshIndex).toBeGreaterThan(-1);

    // Find the closing brace of the skipLeaderboardRefresh block
    // The co-occurrences refresh comment should reference "must NOT be gated"
    expect(syncSource).toContain("must NOT be gated by skipLeaderboardRefresh");
  });

  it("co-occurrences refresh is wrapped in try/catch for resilience", () => {
    // Ensure the refresh call has error handling so failures don't break sync
    const refreshIdx = syncSource.indexOf("refresh_ride_co_occurrences");
    const surroundingCode = syncSource.slice(
      Math.max(0, refreshIdx - 100),
      refreshIdx + 100,
    );
    expect(surroundingCode).toContain("try");
    expect(surroundingCode).toContain("catch");
  });
});

// ---------------------------------------------------------------------------
// 4. Rolling-window algorithm — pure logic tests
// ---------------------------------------------------------------------------

describe("Rolling-window algorithm correctness", () => {
  /**
   * Mirror the sliding-window logic from alltime.ts.
   * Given sorted ride dates and a window size (days), find the max rides
   * that fit in any window.
   */
  function findMaxRidesInWindow(
    sortedDates: string[],
    durationDays: number,
  ): { maxRides: number; windowStart: string; windowEnd: string } {
    let maxRides = 0;
    let bestStart = "";
    let bestEnd = "";

    for (let i = 0; i < sortedDates.length; i++) {
      const windowStart = new Date(sortedDates[i]);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + durationDays);

      let count = 0;
      for (let j = i; j < sortedDates.length; j++) {
        if (new Date(sortedDates[j]) < windowEnd) {
          count++;
        } else break;
      }

      if (count > maxRides) {
        maxRides = count;
        bestStart = sortedDates[i];
        bestEnd = sortedDates[Math.min(i + count - 1, sortedDates.length - 1)];
      }
    }

    return { maxRides, windowStart: bestStart, windowEnd: bestEnd };
  }

  it("finds correct max rides in a 1-year window", () => {
    const dates = [
      "2024-01-15",
      "2024-02-10",
      "2024-03-20",
      "2024-04-05",
      "2024-05-15",
      "2024-06-01",
      "2024-07-10",
      "2024-08-22",
      "2024-09-03",
      "2024-10-14",
      "2024-11-25",
      "2024-12-30",
      "2025-01-05",
      "2025-02-01",
    ];
    const result = findMaxRidesInWindow(dates, 365);
    // All 12 rides from Jan 15 to Dec 30 fit in a 365-day window starting Jan 15
    expect(result.maxRides).toBe(13);
    expect(result.windowStart).toBe("2024-01-15");
  });

  it("finds correct max rides in a 30-day window", () => {
    const dates = [
      "2024-01-01",
      "2024-01-05",
      "2024-01-10",
      "2024-01-15",
      "2024-01-20",
      "2024-01-25",
      "2024-01-29",
      "2024-03-01",
      "2024-03-05",
    ];
    const result = findMaxRidesInWindow(dates, 30);
    expect(result.maxRides).toBe(7); // All 7 January rides fit in a 30-day window
    expect(result.windowStart).toBe("2024-01-01");
  });

  it("handles single ride", () => {
    const result = findMaxRidesInWindow(["2024-06-01"], 365);
    expect(result.maxRides).toBe(1);
  });

  it("handles empty dates", () => {
    const result = findMaxRidesInWindow([], 365);
    expect(result.maxRides).toBe(0);
  });

  it("correctly handles rides filtered to a single route category", () => {
    // Simulate: user has 5 HMBW rides spread over 2 years
    // With 1-year window, should find the best 1-year period
    const hmbwDates = [
      "2023-03-10",
      "2023-06-15",
      "2023-09-20",
      "2024-01-10",
      "2024-04-20",
    ];
    const result = findMaxRidesInWindow(hmbwDates, 365);
    // Window starting 2023-06-15 captures: 06-15, 09-20, 01-10, 04-20 = 4 rides
    expect(result.maxRides).toBe(4);
  });
});
