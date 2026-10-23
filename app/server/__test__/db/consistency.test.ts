/**
 * Leaderboard consistency against independently computed fixture totals
 * (supabase/seed/EXPECTED.json, written by scripts/gen-fixtures.ts).
 *
 * Every server function is called exactly the way the UI calls it today.
 * `it.fails` marks a known discrepancy (see docs/rework/KNOWN_DISCREPANCIES.md):
 * the test documents the correct behavior and is expected to fail until the
 * fix lands — at which point Vitest reports it, and the `.fails` is removed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchLeaderboardImpl } from "../../leaderboard";
import { fetchRidesLeaderboardImpl, fetchUserRidesImpl } from "../../rides";
import { freezeFixtureClock, RIDER } from "../../../test/characterize";

freezeFixtureClock();

interface Expected {
  name: string;
  sf2gVisible: number;
  sf2gVisibleWeekdays: number;
  hiddenRides: number;
}
const EXPECTED = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../supabase/seed/EXPECTED.json"),
    "utf8",
  ),
).perRider as Record<string, Expected>;

const RIDERS_WITH_RIDES = Object.entries(EXPECTED).filter(
  ([, e]) => e.sf2gVisible > 0,
);

function totalsById(
  rows: Array<{ user_id: string | null; sf2g_total: number | null }>,
) {
  return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.sf2g_total)]));
}

function expectTotals(
  rows: Array<{ user_id: string | null; sf2g_total: number | null }>,
  field: "sf2gVisible" | "sf2gVisibleWeekdays",
) {
  const got = totalsById(rows);
  const want = Object.fromEntries(
    RIDERS_WITH_RIDES.map(([id, e]) => [id, e[field]]),
  );
  expect(got).toEqual(want);
}

describe("riders view", () => {
  // Called exactly as the page calls it: every chip goes to get_leaderboard.
  it("D1: 'Exclude Weekends' (default) excludes weekend rides", async () => {
    const rows = await fetchLeaderboardImpl({ excludeWeekends: true });
    expectTotals(rows, "sf2gVisibleWeekdays");
  });

  it("D2: including weekends with a date range includes weekend rides", async () => {
    const rows = await fetchLeaderboardImpl({
      dateFrom: "2000-01-01",
      dateTo: "2026-12-31",
      excludeWeekends: false,
    });
    expectTotals(rows, "sf2gVisible");
  });

  it("D3: hidden rides are not counted", async () => {
    const rows = await fetchLeaderboardImpl({ excludeWeekends: false });
    expect(totalsById(rows)[RIDER.fay]).toBe(EXPECTED[RIDER.fay].sf2gVisible);
  });

  it("route filter and no filter agree for a single-route rider set", async () => {
    // Ivy only rides Skyline, so a Skyline filter must not change her row.
    const all = totalsById(await fetchLeaderboardImpl({}));
    const sky = totalsById(await fetchLeaderboardImpl({ routes: ["skyline"] }));
    expect(sky[RIDER.ivy]).toBe(all[RIDER.ivy]);
  });
});

describe("rides view and profile", () => {
  it("rides view total equals the sum of visible SF2G rides", async () => {
    const res = await fetchRidesLeaderboardImpl({ pageSize: 1000 } as never);
    const want = RIDERS_WITH_RIDES.reduce((s, [, e]) => s + e.sf2gVisible, 0);
    expect((res as { totalCount: number }).totalCount).toBe(want);
  });

  it("a rider's profile ride list excludes hidden rides", async () => {
    const rides = await fetchUserRidesImpl({ userId: RIDER.fay });
    expect(rides.some((r) => r.is_hidden)).toBe(false);
  });

  it("D4: the leaderboard and the rider's own ride list agree on SF2G rides", async () => {
    const rows = await fetchLeaderboardImpl({ excludeWeekends: false });
    const rides = await fetchUserRidesImpl({ userId: RIDER.fay });
    const sf2g = rides.filter(
      (r) => r.route_category && r.route_category !== "other",
    ).length;
    expect(totalsById(rows)[RIDER.fay]).toBe(sf2g);
  });
});

describe("group rides", () => {
  it("lists each group's riders in a stable (alphabetical) order", async () => {
    const { fetchGroupRidesImpl } = await import("../../group-rides");
    for (let i = 0; i < 3; i++) {
      const { groupRides } = await fetchGroupRidesImpl({});
      for (const g of groupRides) {
        const names = g.riders.map((r) => r.displayName);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      }
    }
  });
});

describe("leaderboard regressions (were source-text tests before 03a)", () => {
  it("Bug 4: the years badge shows career years, unaffected by filters", async () => {
    const all = await fetchLeaderboardImpl({ excludeWeekends: false });
    const narrowed = await fetchLeaderboardImpl({
      routes: ["skyline"],
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    });
    const years = (rows: typeof all) =>
      Object.fromEntries(rows.map((r) => [r.user_id, r.active_years]));
    const career = years(all);
    for (const [id, y] of Object.entries(years(narrowed))) {
      expect([id, y]).toEqual([id, career[id]]);
    }
  });

  it("Bug 5: filtering by Other keeps riders whose only matches are Other", async () => {
    const rows = await fetchLeaderboardImpl({
      routes: ["other"],
      excludeWeekends: false,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sf2g_total).toBe(0);
      expect(r.other_count).toBeGreaterThan(0);
    }
  });

  it("% distance denominator counts every ride in the date range", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { LOCAL_SUPABASE } = await import("../../../test/local-supabase");
    const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
    const { data } = await db
      .from("rides")
      .select("distance_meters")
      .eq("user_id", RIDER.ada)
      .gte("ride_date", "2025-01-01")
      .lte("ride_date", "2025-12-31");
    const expected = (data ?? []).reduce(
      (s, r) => s + (r.distance_meters ?? 0),
      0,
    );
    const rows = await fetchLeaderboardImpl({
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
      routes: ["skyline"],
    });
    const ada = rows.find((r) => r.user_id === RIDER.ada);
    expect(ada?.total_distance_meters).toBeCloseTo(expected, 0);
  });

  it("returns one row per rider and never a rider without matching rides", async () => {
    const rows = await fetchLeaderboardImpl({ excludeWeekends: false });
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(rows.length);
    expect(rows.find((r) => r.user_id === RIDER.gus)).toBeUndefined();
  });
});
