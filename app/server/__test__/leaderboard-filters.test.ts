/**
 * Comprehensive leaderboard filter tests.
 *
 * Covers:
 * 1. Route filtering — valid route categories accepted, invalid rejected
 * 2. Time filtering — date validation, date range params
 * 3. PPR filter — PPR dawn ride filtering integration
 * 4. Weekend exclusion — weekday/weekend detection logic
 * 5. Company filter — valid companies accepted, invalid rejected
 * 6. Sort columns — all valid sort columns accepted, invalid ones fall back to default
 * 7. Watts/HR columns — avg_watts, avg_heartrate, average_watts, max_watts, etc.
 * 8. Pagination — page/pageSize params for rides leaderboard
 *
 * Strategy:
 * - Structural analysis of source files for invariants
 * - Unit tests for pure logic functions (date validation, sort validation,
 *   weekend detection, aggregation)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const leaderboardServerSource = readFileSync(
  resolve(__dirname, "../../server/leaderboard.ts"),
  "utf-8",
);

const ridesServerSource = readFileSync(
  resolve(__dirname, "../../server/rides.ts"),
  "utf-8",
);

const leaderboardPageSource = readFileSync(
  resolve(__dirname, "../../routes/leaderboard.tsx"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// 1. Route filtering
// ---------------------------------------------------------------------------

describe("Route filtering", () => {
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

  it("VALID_ROUTE_CATEGORIES in leaderboard.ts contains all 8 routes", () => {
    for (const route of ALL_ROUTES) {
      expect(leaderboardServerSource).toContain(`'${route}'`);
    }
  });

  it("VALID_ROUTE_CATEGORIES in rides.ts contains all 8 routes", () => {
    for (const route of ALL_ROUTES) {
      expect(ridesServerSource).toContain(`'${route}'`);
    }
  });

  it("fetchFilteredLeaderboard validates routeCategories against allow-list", () => {
    expect(leaderboardServerSource).toContain("VALID_ROUTE_CATEGORIES.has(c)");
  });

  it("fetchRidesLeaderboard validates routeCategories against allow-list", () => {
    expect(ridesServerSource).toContain("VALID_ROUTE_CATEGORIES.has(c)");
  });

  it("fetchFilteredLeaderboard uses .in() for route category filter", () => {
    expect(leaderboardServerSource).toContain(
      "query.in('route_category', validCats",
    );
  });

  it("fetchRidesLeaderboard uses .in() for route category filter", () => {
    expect(ridesServerSource).toContain("query.in('route_category', validCats");
  });

  it("fetchFilteredLeaderboard filters out null route_category by default", () => {
    expect(leaderboardServerSource).toContain(
      ".not('route_category', 'is', null)",
    );
  });

  it("fetchRidesLeaderboard filters out null route_category by default", () => {
    expect(ridesServerSource).toContain(".not('route_category', 'is', null)");
  });

  it("leaderboard page passes routes to fetchFilteredLeaderboard", () => {
    expect(leaderboardPageSource).toContain("routeCategories");
  });
});

// ---------------------------------------------------------------------------
// 1b. Route filtering — pure logic unit tests
// ---------------------------------------------------------------------------

describe("Route filtering — allow-list logic", () => {
  // Mirror the validation logic from leaderboard.ts
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

  function filterValidCategories(cats: string[]): string[] {
    return cats.filter((c) => VALID_ROUTE_CATEGORIES.has(c));
  }

  it("keeps all valid categories", () => {
    const input = ["bayway", "skyline", "hmbw"];
    expect(filterValidCategories(input)).toEqual(["bayway", "skyline", "hmbw"]);
  });

  it("removes invalid categories", () => {
    const input = ["bayway", "INVALID", "DROP TABLE rides", "skyline"];
    expect(filterValidCategories(input)).toEqual(["bayway", "skyline"]);
  });

  it("returns empty for all-invalid input", () => {
    const input = ["nonexistent", "fake-route"];
    expect(filterValidCategories(input)).toEqual([]);
  });

  it("handles empty array", () => {
    expect(filterValidCategories([])).toEqual([]);
  });

  it("handles single valid category", () => {
    expect(filterValidCategories(["royale"])).toEqual(["royale"]);
  });

  it("handles all 8 categories at once", () => {
    const all = [
      "bayway",
      "skyline",
      "hmbw",
      "royale",
      "fleaway",
      "mebw",
      "febw",
      "other",
    ];
    expect(filterValidCategories(all)).toEqual(all);
  });
});

// ---------------------------------------------------------------------------
// 2. Time filtering
// ---------------------------------------------------------------------------

describe("Time filtering — date validation", () => {
  // Mirror isValidDateString from leaderboard.ts
  function isValidDateString(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
  }

  it("accepts valid ISO date strings", () => {
    expect(isValidDateString("2024-01-01")).toBe(true);
    expect(isValidDateString("2026-06-14")).toBe(true);
    expect(isValidDateString("2020-12-31")).toBe(true);
  });

  it("rejects non-ISO date formats", () => {
    expect(isValidDateString("01/01/2024")).toBe(false);
    expect(isValidDateString("January 1, 2024")).toBe(false);
    expect(isValidDateString("2024-1-1")).toBe(false);
  });

  it("rejects invalid dates", () => {
    expect(isValidDateString("not-a-date")).toBe(false);
    expect(isValidDateString("0000-00-00")).toBe(false);
    expect(isValidDateString("abcd-ef-gh")).toBe(false);
  });

  it("note: JS Date.parse coerces out-of-range dates (Feb 30 → Mar 1)", () => {
    // This is a known JS behavior — the regex format check is the primary gate
    // The server relies on regex format validation, not calendar correctness
    expect(isValidDateString("2024-02-30")).toBe(true); // coerced by Date.parse
  });

  it("rejects empty string", () => {
    expect(isValidDateString("")).toBe(false);
  });

  it("rejects SQL injection attempts", () => {
    expect(isValidDateString("2024-01-01'; DROP TABLE rides;--")).toBe(false);
    expect(isValidDateString("2024-01-01 OR 1=1")).toBe(false);
  });

  it("rejects datetime strings (only date portion accepted)", () => {
    expect(isValidDateString("2024-01-01T00:00:00Z")).toBe(false);
    expect(isValidDateString("2024-01-01 12:00:00")).toBe(false);
  });
});

describe("Time filtering — server integration", () => {
  it("fetchLeaderboard validates dateFrom with isValidDateString", () => {
    expect(leaderboardServerSource).toContain(
      "isValidDateString(data.dateFrom)",
    );
  });

  it("fetchLeaderboard validates dateTo with isValidDateString", () => {
    expect(leaderboardServerSource).toContain("isValidDateString(data.dateTo)");
  });

  it("fetchLeaderboard uses RPC for date-filtered queries", () => {
    expect(leaderboardServerSource).toContain(
      "'get_leaderboard_by_date_range'",
    );
  });

  it("fetchLeaderboard falls back to materialized view when no dates provided", () => {
    expect(leaderboardServerSource).toContain("from('leaderboard_view')");
  });

  it("fetchFilteredLeaderboard applies .gte for dateFrom", () => {
    expect(leaderboardServerSource).toContain(
      "query.gte('ride_date', dateFrom)",
    );
  });

  it("fetchFilteredLeaderboard applies .lte for dateTo", () => {
    expect(leaderboardServerSource).toContain("query.lte('ride_date', dateTo)");
  });

  it("fetchRidesLeaderboard applies .gte for dateFrom", () => {
    expect(ridesServerSource).toContain(
      "query.gte('ride_date', data.dateFrom)",
    );
  });

  it("fetchRidesLeaderboard applies .lte for dateTo", () => {
    expect(ridesServerSource).toContain("query.lte('ride_date', data.dateTo)");
  });
});

// ---------------------------------------------------------------------------
// 2b. Time filtering — date range computation logic
// ---------------------------------------------------------------------------

describe("Time filtering — date range computation", () => {
  // These mirror the computations done in the leaderboard page for
  // 'ytd', 'month', and custom date ranges

  function computeYtdDateRange(): { dateFrom: string; dateTo: string } {
    const now = new Date();
    const year = now.getFullYear();
    return {
      dateFrom: `${year}-01-01`,
      dateTo: now.toISOString().split("T")[0],
    };
  }

  function computeMonthDateRange(): { dateFrom: string; dateTo: string } {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return {
      dateFrom: `${year}-${month}-01`,
      dateTo: now.toISOString().split("T")[0],
    };
  }

  it("YTD starts on Jan 1 of current year", () => {
    const { dateFrom } = computeYtdDateRange();
    expect(dateFrom).toMatch(/^\d{4}-01-01$/);
    expect(dateFrom.startsWith(String(new Date().getFullYear()))).toBe(true);
  });

  it("YTD ends on today", () => {
    const { dateTo } = computeYtdDateRange();
    const today = new Date().toISOString().split("T")[0];
    expect(dateTo).toBe(today);
  });

  it("month starts on the 1st of current month", () => {
    const { dateFrom } = computeMonthDateRange();
    expect(dateFrom).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("month ends on today", () => {
    const { dateTo } = computeMonthDateRange();
    const today = new Date().toISOString().split("T")[0];
    expect(dateTo).toBe(today);
  });

  it("all-time has no date constraints", () => {
    // When time filter is 'all', no dateFrom/dateTo should be passed
    // Verified by structural check: the leaderboard page conditionally sets dates
    expect(leaderboardPageSource).toContain("dateFrom");
    expect(leaderboardPageSource).toContain("dateTo");
  });
});

// ---------------------------------------------------------------------------
// 3. PPR filter
// ---------------------------------------------------------------------------

describe("PPR filter integration", () => {
  it("fetchPprDawnRiderIds returns riderIds, rideCounts, and rideIds", () => {
    expect(leaderboardServerSource).toContain("riderIds: string[]");
    expect(leaderboardServerSource).toContain(
      "rideCounts: Record<string, number>",
    );
    expect(leaderboardServerSource).toContain("rideIds: string[]");
  });

  it("fetchPprDawnRiderIds uses PPR_INTERCEPTS for timing check", () => {
    expect(leaderboardServerSource).toContain("PPR_INTERCEPTS");
    expect(leaderboardServerSource).toContain("estimateInterceptArrival");
  });

  it("PPR timing window is ±10 minutes", () => {
    expect(leaderboardServerSource).toContain("intercept.targetMinutes - 10");
    expect(leaderboardServerSource).toContain("intercept.targetMinutes + 10");
  });

  it("PPR radius is 500 meters", () => {
    expect(leaderboardServerSource).toContain("PPR_RADIUS_METERS = 500");
  });

  it("rides leaderboard accepts pprRideIds for filtering", () => {
    expect(ridesServerSource).toContain("pprRideIds?: string[]");
  });

  it("rides leaderboard filters by PPR ride IDs using .in()", () => {
    expect(ridesServerSource).toContain("query.in('id', data.pprRideIds)");
  });

  it("rides leaderboard returns empty when PPR active but no qualifying rides", () => {
    expect(ridesServerSource).toContain(
      "data.pprRideIds && data.pprRideIds.length === 0",
    );
    expect(ridesServerSource).toContain("rides: [], totalCount: 0");
  });

  it("PPR filters by date range", () => {
    expect(leaderboardServerSource).toContain("dateFrom?: string");
    expect(leaderboardServerSource).toContain("dateTo?: string");
    // Within fetchPprDawnRiderIds
    const pprSection = leaderboardServerSource.split("fetchPprDawnRiderIds")[1];
    expect(pprSection).toContain("dateFrom");
    expect(pprSection).toContain("dateTo");
  });
});

// ---------------------------------------------------------------------------
// 4. Weekend exclusion
// ---------------------------------------------------------------------------

describe("Weekend exclusion — logic unit tests", () => {
  /** Mirror the weekend check logic from leaderboard.ts and rides.ts */
  function isWeekend(dateStr: string): boolean {
    const day = new Date(dateStr).getUTCDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
  }

  it("identifies Saturday as weekend", () => {
    // 2026-06-13 is a Saturday
    expect(isWeekend("2026-06-13")).toBe(true);
  });

  it("identifies Sunday as weekend", () => {
    // 2026-06-14 is a Sunday
    expect(isWeekend("2026-06-14")).toBe(true);
  });

  it("identifies Monday through Friday as weekdays", () => {
    // 2026-06-08 is Monday through 2026-06-12 is Friday
    expect(isWeekend("2026-06-08")).toBe(false); // Monday
    expect(isWeekend("2026-06-09")).toBe(false); // Tuesday
    expect(isWeekend("2026-06-10")).toBe(false); // Wednesday
    expect(isWeekend("2026-06-11")).toBe(false); // Thursday
    expect(isWeekend("2026-06-12")).toBe(false); // Friday
  });

  it("filters correctly across month boundaries", () => {
    // 2026-05-31 is a Sunday
    expect(isWeekend("2026-05-31")).toBe(true);
    // 2026-06-01 is a Monday
    expect(isWeekend("2026-06-01")).toBe(false);
  });

  it("filtering a ride set removes weekends", () => {
    const rides = [
      { ride_date: "2026-06-08" }, // Mon
      { ride_date: "2026-06-09" }, // Tue
      { ride_date: "2026-06-13" }, // Sat
      { ride_date: "2026-06-14" }, // Sun
      { ride_date: "2026-06-12" }, // Fri
    ];
    const filtered = rides.filter((r) => !isWeekend(r.ride_date));
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.ride_date)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-12",
    ]);
  });
});

describe("Weekend exclusion — server integration", () => {
  it("fetchFilteredLeaderboard defaults excludeWeekends to true", () => {
    expect(leaderboardServerSource).toContain("data.excludeWeekends ?? true");
  });

  it("fetchFilteredLeaderboard filters weekends using getUTCDay()", () => {
    expect(leaderboardServerSource).toContain("getUTCDay()");
    expect(leaderboardServerSource).toContain("day !== 0 && day !== 6");
  });

  it("fetchRidesLeaderboard defaults excludeWeekends to false", () => {
    expect(ridesServerSource).toContain("data.excludeWeekends ?? false");
  });

  it("fetchRidesLeaderboard filters weekends using getUTCDay()", () => {
    expect(ridesServerSource).toContain("getUTCDay()");
    expect(ridesServerSource).toContain("day !== 0 && day !== 6");
  });

  it("fetchLeaderboard passes excludeWeekends to date-range RPC", () => {
    expect(leaderboardServerSource).toContain("p_exclude_weekends");
  });
});

// ---------------------------------------------------------------------------
// 5. Company filter
// ---------------------------------------------------------------------------

describe("Company filter", () => {
  const VALID_COMPANIES = [
    "netflix",
    "google",
    "apple",
    "meta",
    "nvidia",
    "stanford",
    "tesla",
  ];

  it("VALID_COMPANIES set in leaderboard.ts contains all expected companies", () => {
    for (const company of VALID_COMPANIES) {
      expect(leaderboardServerSource).toContain(`'${company}'`);
    }
  });

  it("fetchFilteredLeaderboard validates company against allow-list", () => {
    expect(leaderboardServerSource).toContain(
      "VALID_COMPANIES.has(data.company)",
    );
  });

  it("fetchFilteredLeaderboard applies company filter with .eq()", () => {
    expect(leaderboardServerSource).toContain(
      "query.eq('destination_company', data.company",
    );
  });

  it("fetchRidesLeaderboard applies company filter with .eq()", () => {
    expect(ridesServerSource).toContain(
      "query.eq('destination_company', data.company",
    );
  });

  it("fetchCompanyRiderIds validates company against allow-list", () => {
    expect(leaderboardServerSource).toContain(
      "!VALID_COMPANIES.has(input.company)",
    );
  });

  it("fetchCompanyRiderIds throws for invalid company", () => {
    expect(leaderboardServerSource).toContain(
      "throw new Error(`Invalid company:",
    );
  });
});

describe("Company filter — allow-list logic", () => {
  const VALID_COMPANIES = new Set([
    "netflix",
    "google",
    "apple",
    "meta",
    "nvidia",
    "stanford",
    "tesla",
  ]);

  it("accepts valid company names", () => {
    expect(VALID_COMPANIES.has("google")).toBe(true);
    expect(VALID_COMPANIES.has("netflix")).toBe(true);
    expect(VALID_COMPANIES.has("tesla")).toBe(true);
  });

  it("rejects invalid company names", () => {
    expect(VALID_COMPANIES.has("amazon")).toBe(false);
    expect(VALID_COMPANIES.has("microsoft")).toBe(false);
    expect(VALID_COMPANIES.has("")).toBe(false);
  });

  it("rejects SQL injection in company name", () => {
    expect(VALID_COMPANIES.has("google'; DROP TABLE rides;--")).toBe(false);
  });

  it("is case-sensitive (rejects uppercase)", () => {
    expect(VALID_COMPANIES.has("Google")).toBe(false);
    expect(VALID_COMPANIES.has("APPLE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Sort columns — leaderboard
// ---------------------------------------------------------------------------

describe("Sort columns — leaderboard", () => {
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
  ]);

  it("accepts all documented sort columns", () => {
    const expectedColumns = [
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
    ];
    for (const col of expectedColumns) {
      expect(VALID_LEADERBOARD_SORT_COLUMNS.has(col)).toBe(true);
    }
  });

  it("rejects invalid sort columns", () => {
    expect(VALID_LEADERBOARD_SORT_COLUMNS.has("id")).toBe(false);
    expect(VALID_LEADERBOARD_SORT_COLUMNS.has("password")).toBe(false);
    expect(VALID_LEADERBOARD_SORT_COLUMNS.has("user_id")).toBe(false);
    expect(VALID_LEADERBOARD_SORT_COLUMNS.has("")).toBe(false);
  });

  it("rejects SQL injection in sort column", () => {
    expect(
      VALID_LEADERBOARD_SORT_COLUMNS.has("sf2g_total; DROP TABLE rides"),
    ).toBe(false);
  });

  it("server defaults to sf2g_total when invalid sort column provided", () => {
    expect(leaderboardServerSource).toContain(
      "? data.sortBy\n      : 'sf2g_total'",
    );
  });

  it("server defaults sort direction to desc", () => {
    expect(leaderboardServerSource).toContain("(data.sortDir ?? 'desc')");
  });
});

describe("Sort columns — rides leaderboard", () => {
  const VALID_SORT_COLUMNS = new Set([
    "ride_date",
    "average_speed_mps",
    "distance_meters",
    "elevation_gain_meters",
    "moving_time_seconds",
    "name",
    "tailwind_component_ms",
    "route_category",
    "display_name",
    "average_watts",
    "max_watts",
    "average_heartrate",
    "max_heartrate",
  ]);

  it("accepts all documented rides sort columns", () => {
    const expectedColumns = [
      "ride_date",
      "average_speed_mps",
      "distance_meters",
      "elevation_gain_meters",
      "moving_time_seconds",
      "name",
      "tailwind_component_ms",
      "route_category",
      "display_name",
      "average_watts",
      "max_watts",
      "average_heartrate",
      "max_heartrate",
    ];
    for (const col of expectedColumns) {
      expect(VALID_SORT_COLUMNS.has(col)).toBe(true);
    }
  });

  it("rejects invalid rides sort columns", () => {
    expect(VALID_SORT_COLUMNS.has("user_id")).toBe(false);
    expect(VALID_SORT_COLUMNS.has("strava_activity_id")).toBe(false);
  });

  it("server defaults to ride_date when invalid sort column provided", () => {
    expect(ridesServerSource).toContain("? data.sortBy\n      : 'ride_date'");
  });

  it("display_name sort uses referencedTable for join column", () => {
    expect(ridesServerSource).toContain("sortColumn === 'display_name'");
    expect(ridesServerSource).toContain("referencedTable: 'users'");
  });
});

// ---------------------------------------------------------------------------
// 6b. Sort logic — pure unit tests
// ---------------------------------------------------------------------------

describe("Sort logic — pure unit tests", () => {
  function sortEntries<T extends Record<string, unknown>>(
    entries: T[],
    sortColumn: string,
    ascending: boolean,
  ): T[] {
    return [...entries].sort((a, b) => {
      const aVal = a[sortColumn] ?? 0;
      const bVal = b[sortColumn] ?? 0;
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });
  }

  const testData = [
    { display_name: "Alice", sf2g_total: 50, avg_speed_mps: 8.5 },
    { display_name: "Bob", sf2g_total: 100, avg_speed_mps: 7.2 },
    { display_name: "Charlie", sf2g_total: 75, avg_speed_mps: 9.1 },
  ];

  it("sorts by sf2g_total descending (default)", () => {
    const sorted = sortEntries(testData, "sf2g_total", false);
    expect(sorted[0].display_name).toBe("Bob");
    expect(sorted[1].display_name).toBe("Charlie");
    expect(sorted[2].display_name).toBe("Alice");
  });

  it("sorts by sf2g_total ascending", () => {
    const sorted = sortEntries(testData, "sf2g_total", true);
    expect(sorted[0].display_name).toBe("Alice");
    expect(sorted[1].display_name).toBe("Charlie");
    expect(sorted[2].display_name).toBe("Bob");
  });

  it("sorts by avg_speed_mps descending", () => {
    const sorted = sortEntries(testData, "avg_speed_mps", false);
    expect(sorted[0].display_name).toBe("Charlie");
    expect(sorted[1].display_name).toBe("Alice");
    expect(sorted[2].display_name).toBe("Bob");
  });

  it("sorts by display_name ascending", () => {
    const sorted = sortEntries(testData, "display_name", true);
    expect(sorted[0].display_name).toBe("Alice");
    expect(sorted[1].display_name).toBe("Bob");
    expect(sorted[2].display_name).toBe("Charlie");
  });

  it("handles null values (treats as 0)", () => {
    const dataWithNulls = [
      { name: "A", val: null },
      { name: "B", val: 10 },
      { name: "C", val: 5 },
    ];
    const sorted = sortEntries(dataWithNulls, "val", false);
    expect(sorted[0].name).toBe("B");
    expect(sorted[1].name).toBe("C");
    expect(sorted[2].name).toBe("A");
  });

  it("preserves order for equal values", () => {
    const equalData = [
      { name: "A", val: 10 },
      { name: "B", val: 10 },
    ];
    const sorted = sortEntries(equalData, "val", false);
    expect(sorted).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Watts/HR columns
// ---------------------------------------------------------------------------

describe("Watts/HR columns — leaderboard sort columns", () => {
  it("avg_watts is a valid leaderboard sort column", () => {
    expect(leaderboardServerSource).toContain("'avg_watts'");
    // Verify it's in the VALID_LEADERBOARD_SORT_COLUMNS set
    const sortColumnsSection = leaderboardServerSource.match(
      /VALID_LEADERBOARD_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("avg_watts");
  });

  it("avg_heartrate is a valid leaderboard sort column", () => {
    expect(leaderboardServerSource).toContain("'avg_heartrate'");
    const sortColumnsSection = leaderboardServerSource.match(
      /VALID_LEADERBOARD_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("avg_heartrate");
  });
});

describe("Watts/HR columns — rides sort columns", () => {
  it("average_watts is a valid rides sort column", () => {
    const sortColumnsSection = ridesServerSource.match(
      /VALID_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("average_watts");
  });

  it("max_watts is a valid rides sort column", () => {
    const sortColumnsSection = ridesServerSource.match(
      /VALID_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("max_watts");
  });

  it("average_heartrate is a valid rides sort column", () => {
    const sortColumnsSection = ridesServerSource.match(
      /VALID_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("average_heartrate");
  });

  it("max_heartrate is a valid rides sort column", () => {
    const sortColumnsSection = ridesServerSource.match(
      /VALID_SORT_COLUMNS[\s\S]*?\]\)/,
    );
    expect(sortColumnsSection?.[0]).toContain("max_heartrate");
  });
});

describe("Watts/HR columns — data fetching", () => {
  it("fetchFilteredLeaderboard selects average_watts from rides", () => {
    expect(leaderboardServerSource).toContain("average_watts");
  });

  it("fetchFilteredLeaderboard selects average_heartrate from rides", () => {
    expect(leaderboardServerSource).toContain("average_heartrate");
  });

  it("fetchFilteredLeaderboard aggregates watts into avg_watts", () => {
    expect(leaderboardServerSource).toContain("wattsSum");
    expect(leaderboardServerSource).toContain("wattsCount");
    expect(leaderboardServerSource).toContain("avg_watts: agg.wattsCount > 0");
  });

  it("fetchFilteredLeaderboard aggregates heartrate into avg_heartrate", () => {
    expect(leaderboardServerSource).toContain("hrSum");
    expect(leaderboardServerSource).toContain("hrCount");
    expect(leaderboardServerSource).toContain("avg_heartrate: agg.hrCount > 0");
  });

  it("fetchRidesLeaderboard selects all watts/HR fields", () => {
    const selectSection =
      ridesServerSource.match(/\.select\(\s*`[\s\S]*?`/)?.[0] ?? "";
    expect(selectSection).toContain("average_watts");
    expect(selectSection).toContain("max_watts");
    expect(selectSection).toContain("average_heartrate");
    expect(selectSection).toContain("max_heartrate");
  });

  it("RideLeaderboardEntry maps all watts/HR fields", () => {
    expect(ridesServerSource).toContain("average_watts: row.average_watts");
    expect(ridesServerSource).toContain("max_watts: row.max_watts");
    expect(ridesServerSource).toContain(
      "average_heartrate: row.average_heartrate",
    );
    expect(ridesServerSource).toContain("max_heartrate: row.max_heartrate");
  });
});

describe("Watts/HR columns — leaderboard view type", () => {
  const dbTypesSource = readFileSync(
    resolve(__dirname, "../../lib/database.types.ts"),
    "utf-8",
  );

  it("leaderboard_view Row has avg_watts field", () => {
    expect(dbTypesSource).toContain("avg_watts: number | null");
  });

  it("leaderboard_view Row has avg_heartrate field", () => {
    expect(dbTypesSource).toContain("avg_heartrate: number | null");
  });

  it("RideLeaderboardEntry has average_watts field", () => {
    const rideEntrySection =
      dbTypesSource.split("RideLeaderboardEntry")[1]?.split("}")[0] ?? "";
    expect(rideEntrySection).toContain("average_watts: number | null");
  });

  it("RideLeaderboardEntry has max_watts field", () => {
    const rideEntrySection =
      dbTypesSource.split("RideLeaderboardEntry")[1]?.split("}")[0] ?? "";
    expect(rideEntrySection).toContain("max_watts: number | null");
  });

  it("RideLeaderboardEntry has average_heartrate field", () => {
    const rideEntrySection =
      dbTypesSource.split("RideLeaderboardEntry")[1]?.split("}")[0] ?? "";
    expect(rideEntrySection).toContain("average_heartrate: number | null");
  });

  it("RideLeaderboardEntry has max_heartrate field", () => {
    const rideEntrySection =
      dbTypesSource.split("RideLeaderboardEntry")[1]?.split("}")[0] ?? "";
    expect(rideEntrySection).toContain("max_heartrate: number | null");
  });
});

// ---------------------------------------------------------------------------
// 7b. Watts/HR — aggregation logic unit tests
// ---------------------------------------------------------------------------

describe("Watts/HR — aggregation logic", () => {
  /** Mirror the watts/HR aggregation from fetchFilteredLeaderboard */
  function computeAvg(sum: number, count: number): number | null {
    return count > 0 ? sum / count : null;
  }

  it("computes average watts from multiple rides", () => {
    // 3 rides with watts: 200, 250, 300
    expect(computeAvg(750, 3)).toBeCloseTo(250);
  });

  it("returns null when no rides have watts", () => {
    expect(computeAvg(0, 0)).toBeNull();
  });

  it("ignores null watts values (only counts rides with data)", () => {
    // 2 rides with watts: 200, 300. 1 ride without watts (null, excluded from count)
    expect(computeAvg(500, 2)).toBeCloseTo(250);
  });

  it("computes average heartrate", () => {
    // 4 rides with HR: 140, 150, 160, 170
    expect(computeAvg(620, 4)).toBeCloseTo(155);
  });
});

// ---------------------------------------------------------------------------
// 8. Pagination
// ---------------------------------------------------------------------------

describe("Pagination — rides leaderboard", () => {
  it("defaults page to 1", () => {
    expect(ridesServerSource).toContain("data.page ?? 1");
  });

  it("defaults pageSize to 200", () => {
    expect(ridesServerSource).toContain("data.pageSize ?? 200");
  });

  it("caps pageSize to 500 maximum", () => {
    expect(ridesServerSource).toContain("Math.min(500");
  });

  it("enforces minimum pageSize of 1", () => {
    expect(ridesServerSource).toContain("Math.max(1, data.pageSize");
  });

  it("enforces minimum page of 1", () => {
    expect(ridesServerSource).toContain("Math.max(1, data.page");
  });

  it("computes offset from page and pageSize", () => {
    expect(ridesServerSource).toContain("(page - 1) * pageSize");
  });

  it("uses .range() for pagination", () => {
    expect(ridesServerSource).toContain(
      ".range(offset, offset + pageSize - 1)",
    );
  });

  it("response includes totalCount, page, and pageSize", () => {
    expect(ridesServerSource).toContain("totalCount:");
    expect(ridesServerSource).toContain("page,");
    expect(ridesServerSource).toContain("pageSize,");
  });
});

describe("Pagination — logic unit tests", () => {
  function computePagination(page?: number, pageSize?: number) {
    const p = Math.max(1, page ?? 1);
    const ps = Math.min(500, Math.max(1, pageSize ?? 200));
    const offset = (p - 1) * ps;
    return { page: p, pageSize: ps, offset };
  }

  it("defaults to page 1, pageSize 200, offset 0", () => {
    const result = computePagination();
    expect(result).toEqual({ page: 1, pageSize: 200, offset: 0 });
  });

  it("page 2 with pageSize 200 gives offset 200", () => {
    const result = computePagination(2, 200);
    expect(result).toEqual({ page: 2, pageSize: 200, offset: 200 });
  });

  it("caps pageSize at 500", () => {
    const result = computePagination(1, 1000);
    expect(result.pageSize).toBe(500);
  });

  it("enforces minimum pageSize of 1", () => {
    const result = computePagination(1, 0);
    expect(result.pageSize).toBe(1);
  });

  it("enforces minimum page of 1", () => {
    const result = computePagination(0);
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it("handles negative page number", () => {
    const result = computePagination(-5);
    expect(result.page).toBe(1);
  });

  it("handles negative pageSize", () => {
    const result = computePagination(1, -10);
    expect(result.pageSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Aggregation logic — fetchFilteredLeaderboard
// ---------------------------------------------------------------------------

describe("Aggregation logic — per-user ride aggregation", () => {
  /**
   * Mirror the per-user aggregation from fetchFilteredLeaderboard.
   * Given a set of rides, aggregate per user.
   */
  interface TestRide {
    user_id: string;
    route_category: string | null;
    distance_meters: number;
    elevation_gain_meters: number;
    average_speed_mps: number | null;
    average_watts: number | null;
    average_heartrate: number | null;
    ride_date: string;
  }

  interface UserAgg {
    sf2g_total: number;
    total_rides: number;
    bayway_count: number;
    skyline_count: number;
    other_count: number;
    sf2g_distance: number;
    sf2g_elevation: number;
    speedSum: number;
    speedCount: number;
    wattsSum: number;
    wattsCount: number;
    hrSum: number;
    hrCount: number;
    years: Set<number>;
    lastRideDate: string | null;
    firstRideDate: string | null;
  }

  function aggregateRides(rides: TestRide[]): Map<string, UserAgg> {
    const userMap = new Map<string, UserAgg>();

    for (const ride of rides) {
      let agg = userMap.get(ride.user_id);
      if (!agg) {
        agg = {
          sf2g_total: 0,
          total_rides: 0,
          bayway_count: 0,
          skyline_count: 0,
          other_count: 0,
          sf2g_distance: 0,
          sf2g_elevation: 0,
          speedSum: 0,
          speedCount: 0,
          wattsSum: 0,
          wattsCount: 0,
          hrSum: 0,
          hrCount: 0,
          years: new Set<number>(),
          lastRideDate: null,
          firstRideDate: null,
        };
        userMap.set(ride.user_id, agg);
      }

      const cat = ride.route_category;
      agg.total_rides++;

      if (cat && cat !== "other") {
        agg.sf2g_total++;
        agg.sf2g_distance += ride.distance_meters ?? 0;
        agg.sf2g_elevation += ride.elevation_gain_meters ?? 0;

        if (cat === "bayway") agg.bayway_count++;
        if (cat === "skyline") agg.skyline_count++;

        if (ride.average_speed_mps != null) {
          agg.speedSum += ride.average_speed_mps;
          agg.speedCount++;
        }
        if (ride.average_watts != null) {
          agg.wattsSum += ride.average_watts;
          agg.wattsCount++;
        }
        if (ride.average_heartrate != null) {
          agg.hrSum += ride.average_heartrate;
          agg.hrCount++;
        }

        if (ride.ride_date) {
          const year = new Date(ride.ride_date).getFullYear();
          if (!isNaN(year)) agg.years.add(year);
        }
      } else if (cat === "other") {
        agg.other_count++;
      }

      if (ride.ride_date) {
        if (!agg.lastRideDate || ride.ride_date > agg.lastRideDate) {
          agg.lastRideDate = ride.ride_date;
        }
        if (!agg.firstRideDate || ride.ride_date < agg.firstRideDate) {
          agg.firstRideDate = ride.ride_date;
        }
      }
    }

    return userMap;
  }

  const testRides: TestRide[] = [
    // User A: 2 bayway rides (with watts/HR) + 1 other ride
    {
      user_id: "user-a",
      route_category: "bayway",
      distance_meters: 50000,
      elevation_gain_meters: 300,
      average_speed_mps: 8.5,
      average_watts: 200,
      average_heartrate: 140,
      ride_date: "2026-03-10",
    },
    {
      user_id: "user-a",
      route_category: "bayway",
      distance_meters: 48000,
      elevation_gain_meters: 280,
      average_speed_mps: 9.0,
      average_watts: 220,
      average_heartrate: 150,
      ride_date: "2026-06-10",
    },
    {
      user_id: "user-a",
      route_category: "other",
      distance_meters: 30000,
      elevation_gain_meters: 100,
      average_speed_mps: 7.0,
      average_watts: null,
      average_heartrate: null,
      ride_date: "2026-06-11",
    },
    // User B: 1 skyline ride (no watts/HR)
    {
      user_id: "user-b",
      route_category: "skyline",
      distance_meters: 60000,
      elevation_gain_meters: 800,
      average_speed_mps: 7.5,
      average_watts: null,
      average_heartrate: null,
      ride_date: "2025-01-15",
    },
    // User B: 1 ride with null route_category (should be ignored for sf2g counts)
    {
      user_id: "user-b",
      route_category: null,
      distance_meters: 20000,
      elevation_gain_meters: 50,
      average_speed_mps: 6.0,
      average_watts: null,
      average_heartrate: null,
      ride_date: "2025-06-20",
    },
  ];

  it("counts sf2g_total correctly (excludes other and null)", () => {
    const result = aggregateRides(testRides);
    expect(result.get("user-a")!.sf2g_total).toBe(2);
    expect(result.get("user-b")!.sf2g_total).toBe(1);
  });

  it("counts total_rides correctly (includes other and null)", () => {
    const result = aggregateRides(testRides);
    expect(result.get("user-a")!.total_rides).toBe(3);
    expect(result.get("user-b")!.total_rides).toBe(2);
  });

  it("counts route-specific totals", () => {
    const result = aggregateRides(testRides);
    expect(result.get("user-a")!.bayway_count).toBe(2);
    expect(result.get("user-a")!.skyline_count).toBe(0);
    expect(result.get("user-a")!.other_count).toBe(1);
    expect(result.get("user-b")!.skyline_count).toBe(1);
    expect(result.get("user-b")!.other_count).toBe(0);
  });

  it("sums sf2g distance only from SF2G rides (not other)", () => {
    const result = aggregateRides(testRides);
    // User A: 50000 + 48000 = 98000 (other ride excluded)
    expect(result.get("user-a")!.sf2g_distance).toBe(98000);
    // User B: 60000
    expect(result.get("user-b")!.sf2g_distance).toBe(60000);
  });

  it("aggregates watts only from rides with watts data", () => {
    const result = aggregateRides(testRides);
    // User A: 200 + 220 = 420, count = 2
    expect(result.get("user-a")!.wattsSum).toBe(420);
    expect(result.get("user-a")!.wattsCount).toBe(2);
    // User B: no watts data
    expect(result.get("user-b")!.wattsCount).toBe(0);
  });

  it("aggregates heartrate only from rides with HR data", () => {
    const result = aggregateRides(testRides);
    // User A: 140 + 150 = 290, count = 2
    expect(result.get("user-a")!.hrSum).toBe(290);
    expect(result.get("user-a")!.hrCount).toBe(2);
    // User B: no HR data
    expect(result.get("user-b")!.hrCount).toBe(0);
  });

  it("tracks active years correctly", () => {
    const result = aggregateRides(testRides);
    // User A: 2026 (both bayway rides)
    expect(result.get("user-a")!.years.size).toBe(1);
    expect(result.get("user-a")!.years.has(2026)).toBe(true);
    // User B: 2025
    expect(result.get("user-b")!.years.size).toBe(1);
    expect(result.get("user-b")!.years.has(2025)).toBe(true);
  });

  it("tracks first and last ride dates", () => {
    const result = aggregateRides(testRides);
    expect(result.get("user-a")!.firstRideDate).toBe("2026-03-10");
    expect(result.get("user-a")!.lastRideDate).toBe("2026-06-11");
    expect(result.get("user-b")!.firstRideDate).toBe("2025-01-15");
    expect(result.get("user-b")!.lastRideDate).toBe("2025-06-20");
  });
});

// ---------------------------------------------------------------------------
// 10. Privacy / hidden rides filtering
// ---------------------------------------------------------------------------

describe("Privacy and hidden rides filtering", () => {
  it("fetchFilteredLeaderboard excludes hidden rides", () => {
    expect(leaderboardServerSource).toContain(
      "'is_hidden.eq.false,is_hidden.is.null'",
    );
  });

  it("fetchFilteredLeaderboard excludes private rides", () => {
    expect(leaderboardServerSource).toContain(
      "'is_private.eq.false,is_private.is.null'",
    );
  });

  it("fetchRidesLeaderboard excludes hidden rides", () => {
    expect(ridesServerSource).toContain(
      "'is_hidden.eq.false,is_hidden.is.null'",
    );
  });

  it("fetchRidesLeaderboard excludes private rides", () => {
    expect(ridesServerSource).toContain(
      "'is_private.eq.false,is_private.is.null'",
    );
  });
});

// ---------------------------------------------------------------------------
// 11. Reverse commute direction filter
// ---------------------------------------------------------------------------

describe("Reverse commute direction filter", () => {
  it("fetchFilteredLeaderboard accepts reverse param", () => {
    expect(leaderboardServerSource).toContain("reverse?: boolean");
  });

  it("fetchFilteredLeaderboard filters by g2sf direction when reverse is true", () => {
    expect(leaderboardServerSource).toContain("getCommuteDirection");
    expect(leaderboardServerSource).toContain("=== 'g2sf'");
  });

  it("fetchRidesLeaderboard accepts reverse param", () => {
    expect(ridesServerSource).toContain("reverse?: boolean");
  });

  it("fetchRidesLeaderboard filters by g2sf direction when reverse is true", () => {
    expect(ridesServerSource).toContain("getCommuteDirection");
    expect(ridesServerSource).toContain("=== 'g2sf'");
  });
});

// ---------------------------------------------------------------------------
// 12. Search sanitization (rides leaderboard)
// ---------------------------------------------------------------------------

describe("Search sanitization — ILIKE pattern injection prevention", () => {
  it("fetchRidesLeaderboard sanitizes search input", () => {
    expect(ridesServerSource).toContain("sanitizeLikePattern");
  });

  it("sanitizeLikePattern escapes LIKE special characters", () => {
    // Mirror the sanitizeLikePattern function from rides.ts
    function sanitizeLikePattern(input: string): string {
      return input.replace(/[%_\\]/g, "\\$&");
    }

    expect(sanitizeLikePattern("normal search")).toBe("normal search");
    expect(sanitizeLikePattern("100% complete")).toBe("100\\% complete");
    expect(sanitizeLikePattern("under_score")).toBe("under\\_score");
    expect(sanitizeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(sanitizeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });

  it("fetchRidesLeaderboard uses ILIKE for case-insensitive search", () => {
    expect(ridesServerSource).toContain(".ilike(");
  });
});

// ---------------------------------------------------------------------------
// 13. Supabase query limits
// ---------------------------------------------------------------------------

describe("Supabase query limits", () => {
  it("fetchFilteredLeaderboard uses explicit .limit(1000000)", () => {
    expect(leaderboardServerSource).toContain(".limit(1000000)");
  });

  it("uses request count: exact for rides leaderboard pagination", () => {
    expect(ridesServerSource).toContain("count: 'exact'");
  });
});
