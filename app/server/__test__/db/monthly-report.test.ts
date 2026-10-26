/**
 * Phase 08: get_monthly_report and get_error_groups against the fixture DB.
 * Ride counts are checked against an independent count of the same rows.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { reportError } from "../../report-error";
import {
  renderMonthlyReport,
  type DbReport,
} from "../../../lib/monthly-report";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);
const SCOPE = "test:phase08";

afterAll(async () => {
  await db.from("app_errors").delete().like("scope", "test:%");
});

async function independentCount(from: string, to: string) {
  const { data } = await db
    .from("rides")
    .select("user_id, route_category, is_hidden, is_private")
    .gte("ride_date", from)
    .lt("ride_date", to)
    .not("route_category", "is", null);
  const rows = (data ?? []).filter((r) => !r.is_hidden && !r.is_private);
  const sf2g = rows.filter((r) => r.route_category !== "other");
  return {
    rides: sf2g.length,
    riders: new Set(sf2g.map((r) => r.user_id)).size,
  };
}

describe("get_monthly_report", () => {
  it("counts the same rides as the leaderboard's eligible set", async () => {
    const { data, error } = await db.rpc("get_monthly_report", {
      p_month: "2026-09-01",
    });
    expect(error).toBeNull();
    const report = data as unknown as DbReport;
    const sep = report.months.find((m) => m.offset === 0)!;
    const aug = report.months.find((m) => m.offset === 1)!;
    expect(sep.month).toBe("2026-09");
    expect(report.months.map((m) => m.offset)).toEqual([0, 1, 2, 12]);

    const wantSep = await independentCount("2026-09-01", "2026-10-01");
    const wantAug = await independentCount("2026-08-01", "2026-09-01");
    expect({ rides: sep.sf2g_rides, riders: sep.active_riders }).toEqual(
      wantSep,
    );
    expect({ rides: aug.sf2g_rides, riders: aug.active_riders }).toEqual(
      wantAug,
    );
    expect(Object.values(sep.routes).reduce((a, b) => a + b, 0)).toBe(
      sep.sf2g_rides,
    );
  });

  it("renders an email from real SQL output", async () => {
    const { data } = await db.rpc("get_monthly_report", {
      p_month: "2026-09-01",
    });
    const out = renderMonthlyReport({
      db: data as unknown as DbReport,
      usage: null,
      workers: null,
      notes: [],
      siteUrl: "https://sf2ging.com",
    });
    expect(out.subject).toMatch(/^SF2G September 2026: \d+ SF2G rides/);
    expect(out.html).toContain("Riders of the month");
  });

  it("is not reachable with the anon key", async () => {
    const { error } = await anon.rpc("get_monthly_report", {
      p_month: "2026-09-01",
    });
    expect(error).not.toBeNull();
    const { error: tableError } = await anon
      .from("app_errors")
      .select("id")
      .limit(1);
    expect(tableError).not.toBeNull();
  });
});

describe("app_errors", () => {
  it("stores reported errors and groups repeats by fingerprint", async () => {
    expect(await reportError(SCOPE, new Error("timeout after 8000ms"))).toBe(
      "recorded",
    );
    expect(await reportError(SCOPE, new Error("timeout after 9100ms"))).toBe(
      "recorded",
    );
    expect(await reportError(SCOPE, new Error("Forbidden"))).toBe("expected");

    const { data, error } = await db.rpc("get_error_groups", {
      p_since: "1 hour",
      p_limit: 50,
    });
    expect(error).toBeNull();
    const groups = (data ?? []) as Array<{ scope: string; count: number }>;
    const mine = groups.filter((g) => g.scope === SCOPE);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0].count)).toBe(2);

    const { data: report } = await db.rpc("get_monthly_report", {
      p_month: new Date().toISOString().slice(0, 7) + "-01",
    });
    const r = report as unknown as DbReport;
    expect(r.errors.top.some((e) => e.scope === SCOPE && e.count >= 2)).toBe(
      true,
    );
  });
});
