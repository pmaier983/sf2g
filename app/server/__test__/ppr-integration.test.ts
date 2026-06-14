/**
 * Tests for PPR filter integration.
 *
 * Bug prevented:
 * 1. PPR filter not applied to rides table — rides from non-PPR riders visible
 * 2. PPR dawn result missing rideIds — can't filter rides table by ride
 * 3. Supabase 1000-row limit — queries returning truncated data
 *
 * Strategy: Static analysis of source files to verify structural invariants.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// PPR filter flows through to rides table
// ---------------------------------------------------------------------------

describe("PPR filter completeness", () => {
  const leaderboardPageSource = readFileSync(
    resolve(__dirname, "../../routes/leaderboard.tsx"),
    "utf-8",
  );

  const ridesServerSource = readFileSync(
    resolve(__dirname, "../../server/rides.ts"),
    "utf-8",
  );

  const leaderboardServerSource = readFileSync(
    resolve(__dirname, "../../server/leaderboard.ts"),
    "utf-8",
  );

  const ridesQuerySource = readFileSync(
    resolve(__dirname, "../../queries/rides.ts"),
    "utf-8",
  );

  it("PprDawnResult includes rideIds field", () => {
    // The PPR result must return ride IDs for the rides table filter
    expect(leaderboardServerSource).toContain("rideIds: string[]");
  });

  it("fetchPprDawnRiderIds returns rideIds in all code paths", () => {
    // The word "rideIds" should appear many times in the PPR function:
    // - In the interface definition
    // - In all early returns (empty results)
    // - In the final return (populated results)
    const rideIdMatches = leaderboardServerSource.match(/rideIds/g) ?? [];
    // At minimum: 1 interface + 4 returns = 5 occurrences
    expect(rideIdMatches.length).toBeGreaterThanOrEqual(5);
  });

  it("rides server function accepts pprRideIds parameter", () => {
    expect(ridesServerSource).toContain("pprRideIds");
  });

  it("rides server function filters by pprRideIds when provided", () => {
    // Should use .in('id', pprRideIds) to filter
    expect(ridesServerSource).toContain("data.pprRideIds");
  });

  it("leaderboard page passes pprRideIds to rides query", () => {
    expect(leaderboardPageSource).toContain("pprRideIds");
    // Should conditionally pass when ppr is active
    expect(leaderboardPageSource).toContain("ppr ? pprRideIds");
  });

  it("rides query options include pprRideIds in params", () => {
    expect(ridesQuerySource).toContain("pprRideIds");
  });
});

// ---------------------------------------------------------------------------
// Supabase query limits — prevent 1000-row truncation
// ---------------------------------------------------------------------------

describe("Supabase query limits (prevent 1000-row truncation)", () => {
  const leaderboardServerSource = readFileSync(
    resolve(__dirname, "../../server/leaderboard.ts"),
    "utf-8",
  );

  it("fetchFilteredLeaderboard uses explicit limits on ride queries", () => {
    // All ride queries should have explicit .limit() to prevent Supabase's
    // default 1000-row cap from silently truncating results
    // Count occurrences of .limit(1000000) or similar explicit limits
    const limitMatches = leaderboardServerSource.match(/\.limit\(\d+\)/g) ?? [];
    expect(limitMatches.length).toBeGreaterThanOrEqual(3);
  });

  it("allRides query has explicit limit (bug: 100% dist/elev fix)", () => {
    // The "allRides" query that computes the denominator for %dist/%elev
    // MUST have an explicit limit to avoid truncation at 1000 rows
    // Look for the specific pattern near where allRides is fetched
    const hasAllRidesLimit =
      leaderboardServerSource.includes(".limit(1000000)");
    expect(hasAllRidesLimit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PPR dawn rides result shape
// ---------------------------------------------------------------------------

describe("PprDawnResult shape", () => {
  it("interface has all required fields", () => {
    const source = readFileSync(
      resolve(__dirname, "../../server/leaderboard.ts"),
      "utf-8",
    );

    // Verify the interface shape
    expect(source).toContain("riderIds: string[]");
    expect(source).toContain("rideCounts: Record<string, number>");
    expect(source).toContain("rideIds: string[]");
  });
});

// ---------------------------------------------------------------------------
// Hydration safety — date inputs suppress hydration warnings
// ---------------------------------------------------------------------------

describe("FilterChips hydration safety", () => {
  const filterChipsSource = readFileSync(
    resolve(__dirname, "../../components/FilterChips.tsx"),
    "utf-8",
  );

  it("date inputs have suppressHydrationWarning", () => {
    // The date inputs use local-timezone maxDate which differs between
    // server (UTC) and client (local). suppressHydrationWarning prevents
    // React from complaining about the harmless mismatch.
    const matches = filterChipsSource.match(/suppressHydrationWarning/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // from and to inputs
  });

  it("date inputs use idPrefix for unique IDs", () => {
    // When FilterChips renders in both desktop and mobile layouts,
    // duplicate IDs cause autofill issues. idPrefix prevents this.
    expect(filterChipsSource).toContain("idPrefix");
    expect(filterChipsSource).toContain("`${idPrefix}filter-date-from`");
    expect(filterChipsSource).toContain("`${idPrefix}filter-date-to`");
  });
});
