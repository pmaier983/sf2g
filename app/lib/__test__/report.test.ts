import { describe, expect, it } from "vitest";
import {
  delta,
  fmtKmMi,
  periodLabel,
  periodShort,
  previousPeriod,
  renderReport,
  shiftPeriod,
  weekStart,
  type DbReport,
  type PeriodRow,
  type ReportData,
  type ReportKind,
} from "../report";

function row(
  over: Partial<PeriodRow> & Pick<PeriodRow, "period" | "offset">,
): PeriodRow {
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
    kind: "month",
    period: "2026-09",
    generated_at: "2026-10-01T16:00:12.000Z",
    periods: [
      row({
        period: "2026-09",
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
      row({
        period: "2026-08",
        offset: 1,
        sf2g_rides: 100,
        active_riders: 25,
        sf2g_distance_meters: 5_500_000,
        routes: { bayway: 70, skyline: 30 },
        group_rides: 0,
        errors: 8,
      }),
      row({ period: "2026-07", offset: 2, sf2g_rides: 90, active_riders: 20 }),
      row({
        period: "2025-09",
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

/** The same shape for a week: Oct 19–25 2026 compared with the week before. */
function weekDb(): DbReport {
  return db({
    kind: "week",
    period: "2026-10-19",
    periods: [
      row({
        period: "2026-10-19",
        offset: 0,
        sf2g_rides: 42,
        active_riders: 12,
        sf2g_distance_meters: 2_000_000,
        routes: { bayway: 30, skyline: 12 },
        group_rides: 3,
        errors: 2,
      }),
      row({
        period: "2026-10-12",
        offset: 1,
        sf2g_rides: 35,
        active_riders: 11,
        routes: { bayway: 35 },
        errors: 0,
      }),
      row({ period: "2026-10-05", offset: 2, sf2g_rides: 40 }),
      row({ period: "2025-10-20", offset: 52, sf2g_rides: 21 }),
    ],
  });
}

function data(over: Partial<ReportData> = {}): ReportData {
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

  it("shows both unit systems and period names", () => {
    expect(fmtKmMi(1_609_344)).toBe("1,609 km / 1,000 mi");
    expect(periodLabel("month", "2026-09")).toBe("September 2026");
    expect(periodShort("month", "2026-09")).toBe("Sep");
    // A week is labelled by its Monday–Sunday span.
    expect(periodLabel("week", "2026-10-19")).toBe("Oct 19 – 25, 2026");
    expect(periodLabel("week", "2026-09-28")).toBe("Sep 28 – Oct 4, 2026");
    expect(periodLabel("week", "2025-12-29")).toBe(
      "Dec 29, 2025 – Jan 4, 2026",
    );
    expect(periodShort("week", "2026-10-19")).toBe("Oct 19");
  });
});

describe("period arithmetic", () => {
  it("reports the previous LA month, even just after midnight UTC", () => {
    // The job runs at 16:00 UTC on the 1st, which is Oct 1 in LA → September.
    expect(previousPeriod("month", new Date("2026-10-01T16:00:00Z"))).toBe(
      "2026-09",
    );
    // Early on the 1st UTC it is still the previous day in LA.
    expect(previousPeriod("month", new Date("2026-10-01T03:00:00Z"))).toBe(
      "2026-08",
    );
    expect(previousPeriod("month", new Date("2026-01-15T12:00:00Z"))).toBe(
      "2025-12",
    );
    expect(shiftPeriod("month", "2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("month", "2026-12", 1)).toBe("2027-01");
  });

  it("reports the previous Monday-to-Sunday LA week", () => {
    expect(weekStart("2026-10-28")).toBe("2026-10-26"); // Wed → Mon
    expect(weekStart("2026-10-26")).toBe("2026-10-26"); // Mon stays
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sun → previous Mon
    // Monday Oct 26, 16:00 UTC (9 am LA) → the week of Oct 19.
    expect(previousPeriod("week", new Date("2026-10-26T16:00:00Z"))).toBe(
      "2026-10-19",
    );
    // Monday 03:00 UTC is still Sunday in LA → the week before that.
    expect(previousPeriod("week", new Date("2026-10-26T03:00:00Z"))).toBe(
      "2026-10-12",
    );
    expect(shiftPeriod("week", "2026-10-19", -1)).toBe("2026-10-12");
    expect(shiftPeriod("week", "2025-12-29", 1)).toBe("2026-01-05");
  });
});

describe("renderReport (month)", () => {
  it("puts the headline comparison in the subject", () => {
    const { subject } = renderReport(data());
    expect(subject).toBe(
      "SF2G September 2026: 112 SF2G rides (+12% vs Aug), 23 riders",
    );
  });

  it("compares with last month and the same month last year", () => {
    const { html, text } = renderReport(data());
    expect(html).toContain("SF2G monthly report");
    expect(html).toContain("Riders of the month");
    expect(html).toContain("Three-month trend");
    expect(html).toContain("+12%"); // rides vs Aug
    expect(html).toContain("+100%"); // rides vs Sep 2025 (56 → 112)
    expect(html).toContain("vs Sep 2025");
    expect(html).toContain("−8%"); // active riders 25 → 23
    expect(html).toContain("6,200 km / 3,853 mi");
    expect(text).toContain("SF2G rides                     112 (+12% vs Aug)");
    expect(text).toContain("Bayway");
  });

  it("escapes rider names and links to profiles", () => {
    const { html } = renderReport(data());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Ada &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="https://sf2ging.com/profile/u-1"');
    expect(html).toContain("Anonymous");
  });

  it("explains missing integrations instead of showing empty tables", () => {
    const { html } = renderReport(data());
    expect(html).toContain("POSTHOG_PERSONAL_API_KEY");
    expect(html).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("renders usage and platform sections when provided", () => {
    const { html, text } = renderReport(
      data({
        usage: {
          periods: [
            {
              period: "2026-09",
              pageviews: 2_400,
              visitors: 310,
              sessions: 700,
              client_errors: 4,
            },
            {
              period: "2026-08",
              pageviews: 2_000,
              visitors: 300,
              sessions: 650,
              client_errors: 9,
            },
          ],
          top_pages: [{ path: "/leaderboard", views: 1_800 }],
        },
        workers: {
          periods: [
            {
              period: "2026-09",
              requests: 50_000,
              errors: 25,
              subrequests: 90_000,
              cpu_p50_ms: 2.1,
              cpu_p99_ms: 9.7,
            },
            {
              period: "2026-08",
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
    const { html } = renderReport(data());
    expect(html).toContain("fn:fetchLeaderboard");
    expect(html).toContain("statement timeout");
    expect(html).toContain("Strava 500");
    expect(html).toContain("−38%"); // errors 8 → 5
  });

  it("refuses data without the reported period", () => {
    expect(() => renderReport(data({ db: db({ periods: [] }) }))).toThrow(
      /no row for the reported period/,
    );
  });
});

describe("renderReport (week)", () => {
  it("labels everything by week and compares with the week before", () => {
    const { subject, html, text } = renderReport(data({ db: weekDb() }));
    expect(subject).toBe(
      "SF2G week of Oct 19: 42 SF2G rides (+20% vs Oct 12), 12 riders",
    );
    expect(html).toContain("SF2G weekly report");
    expect(html).toContain("Oct 19 – 25, 2026");
    expect(html).toContain("Riders of the week");
    expect(html).toContain("Three-week trend");
    expect(html).toContain("+20%"); // 35 → 42 rides
    expect(html).toContain("+100%"); // 21 → 42 rides vs a year ago
    expect(html).toContain("vs Oct 20, 2025");
    expect(html).not.toContain("month");
    expect(text).toContain("SF2G weekly report — Oct 19 – 25, 2026");
    expect(text).toContain(
      "SF2G rides                     42 (+20% vs Oct 12)",
    );
  });

  it("says so when nobody rode that week", () => {
    const quiet = weekDb();
    quiet.periods[0] = row({ period: "2026-10-19", offset: 0 });
    quiet.periods[1] = row({ period: "2026-10-12", offset: 1 });
    quiet.top_riders = [];
    const { html } = renderReport(data({ db: quiet }));
    expect(html).toContain("No SF2G rides this week.");
    expect(html).toContain("Nobody rode an SF2G route this week.");
  });
});
