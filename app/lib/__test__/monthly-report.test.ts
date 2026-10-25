import { describe, expect, it } from "vitest";
import {
  delta,
  fmtKmMi,
  monthLabel,
  renderMonthlyReport,
  type DbReport,
  type MonthRow,
  type MonthlyReportData,
} from "../monthly-report";

function month(
  over: Partial<MonthRow> & Pick<MonthRow, "month" | "offset">,
): MonthRow {
  return {
    sf2g_rides: 0,
    other_rides: 0,
    active_riders: 0,
    sf2g_distance_meters: 0,
    sf2g_elevation_meters: 0,
    sf2g_moving_seconds: 0,
    routes: {},
    new_riders: 0,
    group_rides: 0,
    biggest_group: 0,
    sync_jobs_done: 0,
    sync_jobs_failed: 0,
    errors: 0,
    ...over,
  };
}

function db(over: Partial<DbReport> = {}): DbReport {
  return {
    month: "2026-09",
    generated_at: "2026-10-01T16:00:12.000Z",
    months: [
      month({
        month: "2026-09",
        offset: 0,
        sf2g_rides: 112,
        other_rides: 40,
        active_riders: 23,
        sf2g_distance_meters: 6_200_000,
        sf2g_elevation_meters: 61_000,
        sf2g_moving_seconds: 900_000,
        routes: { bayway: 60, skyline: 40, hmbw: 12 },
        new_riders: 3,
        group_rides: 9,
        biggest_group: 6,
        sync_jobs_done: 410,
        sync_jobs_failed: 2,
        errors: 5,
      }),
      month({
        month: "2026-08",
        offset: 1,
        sf2g_rides: 100,
        active_riders: 25,
        sf2g_distance_meters: 5_500_000,
        routes: { bayway: 70, skyline: 30 },
        group_rides: 0,
        errors: 8,
      }),
      month({ month: "2026-07", offset: 2, sf2g_rides: 90, active_riders: 20 }),
      month({
        month: "2025-09",
        offset: 12,
        sf2g_rides: 56,
        active_riders: 15,
      }),
    ],
    top_riders: [
      {
        user_id: "u-1",
        display_name: "Ada <script>alert(1)</script>",
        rides: 18,
        distance_meters: 1_000_000,
      },
      {
        user_id: "u-2",
        display_name: null,
        rides: 12,
        distance_meters: 650_000,
      },
    ],
    riders: {
      connected: 70,
      needs_reauth: 2,
      synced_last_7_days: 61,
      never_synced: 1,
    },
    sync: {
      open_jobs: 3,
      failed_jobs_open: 1,
      top_errors: [{ message: "Strava 500", count: 2 }],
    },
    errors: {
      top: [
        {
          scope: "fn:fetchLeaderboard",
          fingerprint: "abcd1234",
          message:
            "get_leaderboard failed: canceling statement due to statement timeout",
          count: 4,
          last_seen: "2026-09-20T01:00:00Z",
        },
      ],
    },
    all_time: {
      sf2g_rides: 12_345,
      riders_with_rides: 68,
      sf2g_distance_meters: 700_000_000,
    },
    ...over,
  };
}

function data(over: Partial<MonthlyReportData> = {}): MonthlyReportData {
  return {
    db: db(),
    usage: null,
    workers: null,
    notes: [],
    siteUrl: "https://sf2ging.com",
    ...over,
  };
}

describe("formatting", () => {
  it("delta reads like a person would say it", () => {
    expect(delta(112, 100)).toEqual({ label: "+12%", direction: "up" });
    expect(delta(92, 100)).toEqual({ label: "−8%", direction: "down" });
    expect(delta(100, 100)).toEqual({ label: "=", direction: "flat" });
    expect(delta(5, 0)).toEqual({ label: "new", direction: "new" });
    expect(delta(0, 0)).toEqual({ label: "=", direction: "flat" });
    expect(delta(3, undefined)).toEqual({ label: "–", direction: "flat" });
  });

  it("shows both unit systems and month names", () => {
    expect(fmtKmMi(1_609_344)).toBe("1,609 km / 1,000 mi");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});

describe("renderMonthlyReport", () => {
  it("puts the headline comparison in the subject", () => {
    const { subject } = renderMonthlyReport(data());
    expect(subject).toBe(
      "SF2G September 2026: 112 SF2G rides (+12% vs Aug), 23 riders",
    );
  });

  it("compares with last month and the same month last year", () => {
    const { html, text } = renderMonthlyReport(data());
    expect(html).toContain("+12%"); // rides vs Aug
    expect(html).toContain("+100%"); // rides vs Sep 2025 (56 → 112)
    expect(html).toContain("−8%"); // active riders 25 → 23
    expect(html).toContain("6,200 km / 3,853 mi");
    expect(text).toContain("SF2G rides                     112 (+12% vs Aug)");
    expect(text).toContain("Bayway");
  });

  it("escapes rider names and links to profiles", () => {
    const { html } = renderMonthlyReport(data());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Ada &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="https://sf2ging.com/profile/u-1"');
    expect(html).toContain("Anonymous");
  });

  it("explains missing integrations instead of showing empty tables", () => {
    const { html } = renderMonthlyReport(data());
    expect(html).toContain("POSTHOG_PERSONAL_API_KEY");
    expect(html).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("renders usage and platform sections when provided", () => {
    const { html, text } = renderMonthlyReport(
      data({
        usage: {
          months: [
            {
              month: "2026-09",
              pageviews: 2_400,
              visitors: 310,
              sessions: 700,
              client_errors: 4,
            },
            {
              month: "2026-08",
              pageviews: 2_000,
              visitors: 300,
              sessions: 650,
              client_errors: 9,
            },
          ],
          top_pages: [{ path: "/leaderboard", views: 1_800 }],
        },
        workers: {
          months: [
            {
              month: "2026-09",
              requests: 50_000,
              errors: 25,
              subrequests: 90_000,
              cpu_p50_ms: 2.1,
              cpu_p99_ms: 9.7,
            },
            {
              month: "2026-08",
              requests: 40_000,
              errors: 400,
              subrequests: 80_000,
              cpu_p50_ms: 3.4,
              cpu_p99_ms: 11.2,
            },
          ],
        },
        notes: ["Cloudflare: September has 29 days of data"],
      }),
    );
    expect(html).toContain("+20%"); // pageviews
    expect(html).toContain("/leaderboard");
    expect(html).toContain("0.05%"); // error rate
    expect(html).toContain("2.1 / 9.7 ms");
    expect(html).not.toContain("POSTHOG_PERSONAL_API_KEY");
    expect(html).toContain("September has 29 days of data");
    expect(text).toContain("  Worker requests              50,000");
  });

  it("lists server and sync errors in the health section", () => {
    const { html } = renderMonthlyReport(data());
    expect(html).toContain("fn:fetchLeaderboard");
    expect(html).toContain("statement timeout");
    expect(html).toContain("Strava 500");
    expect(html).toContain("−38%"); // errors 8 → 5
  });

  it("refuses data without the reported month", () => {
    expect(() => renderMonthlyReport(data({ db: db({ months: [] }) }))).toThrow(
      /no row for the reported month/,
    );
  });
});
