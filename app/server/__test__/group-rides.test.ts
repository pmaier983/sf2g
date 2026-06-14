/**
 * Group Rides feature — structural tests.
 *
 * Verifies:
 * 1. Server function accepts and applies all filter params (route, date, weekends)
 * 2. Query factory includes filter params for cache invalidation
 * 3. Leaderboard page passes filters through to group rides query
 * 4. GroupRidesTable uses correct scrollable container + circular avatars
 * 5. GroupRideMap uses Leaflet (not Mapbox) with CartoDB tiles
 * 6. CSS consistency with leaderboard table styling
 *
 * Strategy: Static analysis of source files to verify structural invariants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const serverSource = readFileSync(
  resolve(__dirname, "../../server/group-rides.ts"),
  "utf-8",
);

const querySource = readFileSync(
  resolve(__dirname, "../../queries/group-rides.ts"),
  "utf-8",
);

const leaderboardSource = readFileSync(
  resolve(__dirname, "../../routes/leaderboard.tsx"),
  "utf-8",
);

const tableSource = readFileSync(
  resolve(__dirname, "../../components/GroupRidesTable.tsx"),
  "utf-8",
);

const mapSource = readFileSync(
  resolve(__dirname, "../../components/GroupRideMap.tsx"),
  "utf-8",
);

const cssSource = readFileSync(
  resolve(__dirname, "../../styles/group-rides.css"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// 1. Server function structure
// ---------------------------------------------------------------------------

describe("Server function: fetchGroupRides", () => {
  it("accepts routeCategories filter param", () => {
    expect(serverSource).toContain("routeCategories?: string[]");
  });

  it("accepts weekends filter param", () => {
    expect(serverSource).toContain("weekends?: boolean");
  });

  it("accepts dateFrom and dateTo filter params", () => {
    expect(serverSource).toContain("dateFrom?: string");
    expect(serverSource).toContain("dateTo?: string");
  });

  it("applies date filtering with continue statements", () => {
    expect(serverSource).toContain(
      "if (data.dateFrom && row.ride_date < data.dateFrom) continue",
    );
    expect(serverSource).toContain(
      "if (data.dateTo && row.ride_date > data.dateTo) continue",
    );
  });

  it("applies route category filtering", () => {
    expect(serverSource).toContain("data.routeCategories");
    expect(serverSource).toContain(
      "!data.routeCategories.includes(row.route_category)",
    );
  });

  it("applies weekend filtering using day-of-week check", () => {
    expect(serverSource).toContain("data.weekends === false");
    expect(serverSource).toContain("getUTCDay()");
    // Saturday = 6, Sunday = 0
    expect(serverSource).toContain("dayOfWeek === 0 || dayOfWeek === 6");
  });

  it("uses polyline overlap threshold of 0.3", () => {
    expect(serverSource).toContain("MIN_POLYLINE_OVERLAP = 0.3");
  });

  it("uses page size of 25", () => {
    expect(serverSource).toContain("PAGE_SIZE = 25");
  });

  it("does NOT hardcode a year filter in the SQL query", () => {
    // The materialized view should not have year restrictions
    // The server fetches ALL co-ride pairs, then filters in-memory
    expect(serverSource).not.toMatch(/ride_date.*2026|YEAR|extract.*year/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Query factory
// ---------------------------------------------------------------------------

describe("Query factory: groupRidesQueryOptions", () => {
  it("includes routeCategories param", () => {
    expect(querySource).toContain("routeCategories?: string[]");
  });

  it("includes weekends param", () => {
    expect(querySource).toContain("weekends?: boolean");
  });

  it("uses params in query key for cache invalidation", () => {
    expect(querySource).toContain("queryKey: ['group-rides', params]");
  });
});

// ---------------------------------------------------------------------------
// 3. Leaderboard integration
// ---------------------------------------------------------------------------

describe("Leaderboard: Group Rides integration", () => {
  it("imports GroupRidesTable", () => {
    expect(leaderboardSource).toContain("import { GroupRidesTable }");
  });

  it("imports groupRidesQueryOptions", () => {
    expect(leaderboardSource).toContain("import { groupRidesQueryOptions }");
  });

  it("has groups as a valid view type", () => {
    expect(leaderboardSource).toContain(
      "'riders' | 'rides' | 'alltime' | 'groups'",
    );
  });

  it("passes routeCategories from routes filter to group rides query", () => {
    expect(leaderboardSource).toContain(
      "routeCategories: routes.length > 0 ? routes : undefined",
    );
  });

  it("passes weekends filter to group rides query", () => {
    // Should pass `weekends` to the query options
    expect(leaderboardSource).toMatch(
      /groupRidesQueryOptions\(\{[\s\S]*?weekends[\s\S]*?\}\)/,
    );
  });

  it("passes dateFrom and dateTo to group rides query", () => {
    expect(leaderboardSource).toContain("dateFrom: dateFrom || undefined");
    expect(leaderboardSource).toContain("dateTo: dateTo || undefined");
  });

  it("has gSort, gDir, gPage params in search defaults", () => {
    expect(leaderboardSource).toContain("gSort:");
    expect(leaderboardSource).toContain("gDir:");
    expect(leaderboardSource).toContain("gPage:");
  });

  it("renders GroupRidesTable when view is groups", () => {
    expect(leaderboardSource).toContain("<GroupRidesTable");
    expect(leaderboardSource).toContain("view === 'groups'");
  });

  it("passes isLoading to GroupRidesTable", () => {
    expect(leaderboardSource).toContain(
      "isLoading={groupRidesQuery.isLoading}",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. GroupRidesTable component
// ---------------------------------------------------------------------------

describe("GroupRidesTable component", () => {
  it("exports GroupRidesTable as a named export", () => {
    expect(tableSource).toContain("export function GroupRidesTable");
  });

  it("uses group-rides-table__wrapper class for scrollable container", () => {
    expect(tableSource).toContain("group-rides-table__wrapper");
  });

  it("uses group-rides-table__avatar class for circular photos", () => {
    expect(tableSource).toContain("group-rides-table__avatar");
  });

  it("accepts isLoading prop", () => {
    expect(tableSource).toContain("isLoading: boolean");
  });

  it("shows skeleton rows when loading", () => {
    expect(tableSource).toContain("group-rides-table__skeleton");
    expect(tableSource).toContain("GroupRideSkeletonRows");
  });

  it("only shows empty state when NOT loading", () => {
    expect(tableSource).toContain("!isLoading && data.length === 0");
  });

  it("has date column", () => {
    expect(tableSource).toContain("'date'");
  });

  it("has route category column", () => {
    expect(tableSource).toContain("'routeCategory'");
  });

  it("has rider count column", () => {
    expect(tableSource).toContain("'riderCount'");
  });

  it("has average speed column", () => {
    expect(tableSource).toContain("'avgSpeedMps'");
  });

  it("has average watts column", () => {
    expect(tableSource).toContain("'avgWatts'");
  });

  it("has average heartrate column", () => {
    expect(tableSource).toContain("'avgHeartrate'");
  });
});

// ---------------------------------------------------------------------------
// 5. GroupRideMap component
// ---------------------------------------------------------------------------

describe("GroupRideMap component", () => {
  it("uses Leaflet (dynamic import)", () => {
    expect(mapSource).toContain("import('leaflet')");
  });

  it("does NOT reference mapbox-gl", () => {
    expect(mapSource).not.toContain("mapbox-gl");
  });

  it("does NOT reference VITE_MAPBOX_TOKEN", () => {
    expect(mapSource).not.toContain("VITE_MAPBOX_TOKEN");
  });

  it("uses CartoDB tile URLs", () => {
    expect(mapSource).toContain("cartocdn.com");
  });

  it("uses useTheme hook for dark/light mode", () => {
    expect(mapSource).toContain("useTheme");
  });
});

// ---------------------------------------------------------------------------
// 6. CSS consistency with leaderboard
// ---------------------------------------------------------------------------

describe("CSS: Group rides table matches leaderboard styling", () => {
  it("uses --color-dark-bar for header background", () => {
    expect(cssSource).toContain("--color-dark-bar");
  });

  it("uses --color-sf2g-orange for accent border", () => {
    expect(cssSource).toContain("--color-sf2g-orange");
  });

  it("wrapper has overflow-x: auto for horizontal scrollability", () => {
    expect(cssSource).toContain("overflow-x: auto");
  });

  it("wrapper has border-radius for rounded corners", () => {
    expect(cssSource).toContain("border-radius: var(--radius-md)");
  });

  it("avatar size is 24px", () => {
    expect(cssSource).toMatch(/group-rides-table__avatar[\s\S]*?width:\s*24px/);
    expect(cssSource).toMatch(
      /group-rides-table__avatar[\s\S]*?height:\s*24px/,
    );
  });

  it("avatars are circular (border-radius: 50%)", () => {
    expect(cssSource).toMatch(
      /group-rides-table__avatar[\s\S]*?border-radius:\s*50%/,
    );
  });

  it("marker wrapper resets Leaflet defaults", () => {
    expect(cssSource).toContain("group-ride-map__marker-wrapper");
    expect(cssSource).toContain("background: none");
  });

  it("uses border-collapse: collapse (same as leaderboard)", () => {
    expect(cssSource).toContain("border-collapse: collapse");
  });

  it("has skeleton loading shimmer animation", () => {
    expect(cssSource).toContain("group-rides-table__skeleton");
    expect(cssSource).toContain("skeleton-shimmer");
  });
});
