/**
 * Phase 08 (+ weekly): get_report and get_error_groups against the fixture
 * DB. Ride counts are checked against an independent count of the same rows.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { LOCAL_SUPABASE } from "../../../test/local-supabase";
import { reportError } from "../../report-error";
import { renderReport, type DbReport } from "../../../lib/report";

const db = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.serviceRoleKey);
const anon = createClient(LOCAL_SUPABASE.url, LOCAL_SUPABASE.anonKey);
const SCOPE = "test:phase08";

afterAll(async () => {
  await db.from("app_errors").delete().like("scope", "test:%");
  await db.from("reports").delete().eq("subject", "test:report");
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

describe("get_report (month)", () => {
  it("counts the same rides as the leaderboard's eligible set", async () => {
    const { data, error } = await db.rpc("get_report", {
      p_kind: "month",
      p_start: "2026-09-01",
    });
    expect(error).toBeNull();
    const report = data as unknown as DbReport;
    expect(report.kind).toBe("month");
    expect(report.period).toBe("2026-09");
    const sep = report.periods.find((m) => m.offset === 0)!;
    const aug = report.periods.find((m) => m.offset === 1)!;
    expect(sep.period).toBe("2026-09");
    expect(report.periods.map((m) => m.offset)).toEqual([0, 1, 2, 12]);
    expect(report.periods.map((m) => m.period)).toEqual([
      "2026-09",
      "2026-08",
      "2026-07",
      "2025-09",
    ]);

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
    const { data } = await db.rpc("get_report", {
      p_kind: "month",
      p_start: "2026-09-01",
    });
    const out = renderReport({
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
    const { error } = await anon.rpc("get_report", {
      p_kind: "month",
      p_start: "2026-09-01",
    });
    expect(error).not.toBeNull();
    const { error: tableError } = await anon
      .from("app_errors")
      .select("id")
      .limit(1);
    expect(tableError).not.toBeNull();
    const { error: reportsError } = await anon
      .from("reports")
      .select("kind")
      .limit(1);
    expect(reportsError).not.toBeNull();
  });
});

describe("get_report (week)", () => {
  it("counts Monday-to-Sunday weeks and compares with 52 weeks earlier", async () => {
    // Any day of the week may be passed; the function snaps to its Monday.
    const { data, error } = await db.rpc("get_report", {
      p_kind: "week",
      p_start: "2026-09-17", // a Thursday
    });
    expect(error).toBeNull();
    const report = data as unknown as DbReport;
    expect(report.kind).toBe("week");
    expect(report.period).toBe("2026-09-14");
    expect(report.periods.map((m) => m.offset)).toEqual([0, 1, 2, 52]);
    expect(report.periods.map((m) => m.period)).toEqual([
      "2026-09-14",
      "2026-09-07",
      "2026-08-31",
      "2025-09-15",
    ]);

    const cur = report.periods[0];
    const prev = report.periods[1];
    const wantCur = await independentCount("2026-09-14", "2026-09-21");
    const wantPrev = await independentCount("2026-09-07", "2026-09-14");
    expect({ rides: cur.sf2g_rides, riders: cur.active_riders }).toEqual(
      wantCur,
    );
    expect({ rides: prev.sf2g_rides, riders: prev.active_riders }).toEqual(
      wantPrev,
    );
    // The fixture has rides in September 2026; a week of it must be non-empty.
    expect(cur.sf2g_rides + prev.sf2g_rides).toBeGreaterThan(0);

    const out = renderReport({
      db: report,
      usage: null,
      workers: null,
      notes: [],
      siteUrl: "https://sf2ging.com",
    });
    expect(out.subject).toMatch(/^SF2G week of Sep 14: \d+ SF2G rides/);
    expect(out.html).toContain("Riders of the week");
  });
});

describe("reports table", () => {
  it("keeps a week and a month with the same start date apart", async () => {
    const base = {
      period_start: "2026-06-01",
      subject: "test:report",
      html: "<p/>",
      text: "",
      data: {},
    };
    const { error } = await db.from("reports").upsert([
      { ...base, kind: "week" },
      { ...base, kind: "month" },
    ]);
    expect(error).toBeNull();
    const { data } = await db
      .from("reports")
      .select("kind")
      .eq("period_start", "2026-06-01")
      .eq("subject", "test:report");
    expect(data?.map((r) => r.kind).sort()).toEqual(["month", "week"]);
    const { error: badKind } = await db
      .from("reports")
      .insert({ ...base, period_start: "2026-06-02", kind: "day" });
    expect(badKind).not.toBeNull();
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

    const { data: report } = await db.rpc("get_report", {
      p_kind: "week",
      p_start: new Date().toISOString().slice(0, 10),
    });
    const r = report as unknown as DbReport;
    expect(r.errors.top.some((e) => e.scope === SCOPE && e.count >= 2)).toBe(
      true,
    );
  });
});
