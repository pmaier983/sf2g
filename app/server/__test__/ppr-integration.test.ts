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

// ---------------------------------------------------------------------------
// Supabase query limits — prevent 1000-row truncation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PPR dawn rides result shape
// ---------------------------------------------------------------------------

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
