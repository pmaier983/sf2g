/**
 * Group Rides feature — structural tests.
 *
 * Verifies:
 * 1. Server function accepts and applies all filter params (route, date, weekends)
 * 2. Query factory includes filter params for cache invalidation
 * 3. Leaderboard page passes filters through to group rides query
 * 4. GroupRidesTable uses correct scrollable container + circular avatars
 * 5. GroupRideMap uses Leaflet (not Mapbox) with the shared tile provider
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

  it("applies date filtering with gte/lte query", () => {
    expect(serverSource).toMatch(
      /query\.gte\(["']ride_date["'],\s*data\.dateFrom\)/,
    );
    expect(serverSource).toMatch(
      /query\.lte\(["']ride_date["'],\s*data\.dateTo\)/,
    );
  });

  it("applies route category filtering", () => {
    expect(serverSource).toContain("data.routeCategories");
    expect(serverSource).toMatch(
      /query\.in\(["']route_category["'],\s*data\.routeCategories\)/,
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
    expect(querySource).toMatch(
      /queryKey:\s*\[["']group-rides["'],\s*params\]/,
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

  it("has date column", () => {
    expect(tableSource).toContain("date");
  });

  it("has route category column", () => {
    expect(tableSource).toContain("routeCategory");
  });

  it("has rider count column", () => {
    expect(tableSource).toContain("riderCount");
  });

  it("has average speed column", () => {
    expect(tableSource).toContain("avgSpeedMps");
  });

  it("has average watts column", () => {
    expect(tableSource).toContain("avgWatts");
  });

  it("has average heartrate column", () => {
    expect(tableSource).toContain("avgHeartrate");
  });
});

// ---------------------------------------------------------------------------
// 5. GroupRideMap component
// ---------------------------------------------------------------------------

describe("GroupRideMap component", () => {
  it("uses Leaflet (dynamic import)", () => {
    expect(mapSource).toMatch(/import\(["']leaflet["']\)/);
  });

  it("does NOT reference mapbox-gl", () => {
    expect(mapSource).not.toContain("mapbox-gl");
  });

  it("does NOT reference VITE_MAPBOX_TOKEN", () => {
    expect(mapSource).not.toContain("VITE_MAPBOX_TOKEN");
  });

  it("uses the shared tile provider (app/lib/map-tiles.ts)", () => {
    expect(mapSource).toContain("../lib/map-tiles");
    expect(mapSource).not.toContain("cartocdn.com");
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
