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
import {
  fetchFilteredLeaderboardImpl,
  fetchLeaderboardImpl,
} from "../../leaderboard";
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

describe("riders view — default (no route/company/reverse filter)", () => {
  // UI: leaderboardQueryOptions({ sortBy, sortDir, dateFrom, dateTo }) — the
  // "Exclude Weekends" chip (on by default) is never passed through.
  it.fails(
    "D1: 'Exclude Weekends' (default) excludes weekend rides when no date range is set",
    async () => {
      const rows = await fetchLeaderboardImpl({
        sortBy: "sf2g_total",
        sortDir: "desc",
      });
      expectTotals(rows, "sf2gVisibleWeekdays");
    },
  );

  it.fails(
    "D2: turning weekends on with a date range includes weekend rides",
    async () => {
      // weekends=true in the URL; the UI still sends only the dates.
      const rows = await fetchLeaderboardImpl({
        sortBy: "sf2g_total",
        sortDir: "desc",
        dateFrom: "2000-01-01",
        dateTo: "2026-12-31",
      });
      expectTotals(rows, "sf2gVisible");
    },
  );

  it.fails("D3: hidden rides are not counted", async () => {
    const rows = await fetchLeaderboardImpl({});
    expect(totalsById(rows)[RIDER.fay]).toBe(EXPECTED[RIDER.fay].sf2gVisible);
  });
});

describe("riders view — compound filters (JS aggregation path)", () => {
  it("excluding weekends matches the visible weekday totals", async () => {
    const rows = await fetchFilteredLeaderboardImpl({ excludeWeekends: true });
    expectTotals(rows, "sf2gVisibleWeekdays");
  });

  it("including weekends matches the visible totals", async () => {
    const rows = await fetchFilteredLeaderboardImpl({ excludeWeekends: false });
    expectTotals(rows, "sf2gVisible");
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

  it.fails(
    "D4: the default leaderboard and the rider's own ride list agree on SF2G rides",
    async () => {
      const rows = await fetchLeaderboardImpl({});
      const rides = await fetchUserRidesImpl({ userId: RIDER.fay });
      const sf2g = rides.filter(
        (r) => r.route_category && r.route_category !== "other",
      ).length;
      expect(totalsById(rows)[RIDER.fay]).toBe(sf2g);
    },
  );
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
