/**
 * Phase 08: the monthly report run — month selection, idempotency, storing
 * before sending, and how optional sources and email failures are handled.
 * Supabase, PostHog, Cloudflare and Resend are all faked at the edges.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMonthlyReport,
  previousMonth,
  runMonthlyReport,
  shiftMonth,
  type MonthlyReportDeps,
} from "../monthly-report";
import type { EmailMessage } from "../email";

vi.mock("../report-error", () => ({
  reportError: vi.fn(async () => "recorded"),
}));

const DB_REPORT = {
  month: "2026-09",
  generated_at: "2026-10-01T16:00:00Z",
  months: [
    {
      month: "2026-09",
      offset: 0,
      sf2g_rides: 10,
      other_rides: 1,
      active_riders: 4,
      sf2g_distance_meters: 500_000,
      sf2g_elevation_meters: 4_000,
      sf2g_moving_seconds: 70_000,
      routes: { bayway: 6, skyline: 4 },
      new_riders: 1,
      group_rides: 2,
      biggest_group: 3,
      sync_jobs_done: 50,
      sync_jobs_failed: 0,
      errors: 1,
    },
    {
      month: "2026-08",
      offset: 1,
      sf2g_rides: 8,
      other_rides: 0,
      active_riders: 3,
      sf2g_distance_meters: 400_000,
      sf2g_elevation_meters: 3_000,
      sf2g_moving_seconds: 60_000,
      routes: { bayway: 8 },
      new_riders: 0,
      group_rides: 1,
      biggest_group: 2,
      sync_jobs_done: 40,
      sync_jobs_failed: 1,
      errors: 3,
    },
  ],
  top_riders: [],
  riders: {
    connected: 8,
    needs_reauth: 0,
    synced_last_7_days: 8,
    never_synced: 0,
  },
  sync: { open_jobs: 0, failed_jobs_open: 0, top_errors: [] },
  errors: { top: [] },
  all_time: {
    sf2g_rides: 296,
    riders_with_rides: 8,
    sf2g_distance_meters: 16_000_000,
  },
};

/** Minimal in-memory stand-in for the three Supabase calls the run makes. */
function fakeSupabase(initial: Record<string, unknown> | null = null) {
  const rows = new Map<string, Record<string, unknown>>();
  if (initial) rows.set(String(initial.month), initial);
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "get_monthly_report") return { data: DB_REPORT, error: null };
    if (fn === "prune_app_errors") return { data: 0, error: null };
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  });
  const from = vi.fn((table: string) => {
    if (table !== "monthly_reports")
      throw new Error(`unexpected table ${table}`);
    let month = "";
    const chain = {
      select: () => chain,
      eq: (_c: string, v: string) => {
        month = v;
        return chain;
      },
      maybeSingle: async () => ({ data: rows.get(month) ?? null, error: null }),
      upsert: async (row: Record<string, unknown>) => {
        rows.set(String(row.month), { ...rows.get(String(row.month)), ...row });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_c: string, v: string) => {
          rows.set(v, { ...rows.get(v), ...patch });
          return { error: null };
        },
      }),
    };
    return chain;
  });
  return {
    client: { rpc, from } as unknown as MonthlyReportDeps["supabase"],
    rows,
    rpc,
  };
}

function deps(
  over: Partial<MonthlyReportDeps> = {},
  sent: EmailMessage[] = [],
) {
  const sb = fakeSupabase();
  const d: MonthlyReportDeps = {
    supabase: sb.client,
    fetch: vi.fn(async () => new Response("{}")) as unknown as typeof fetch,
    env: { APP_URL: "https://sf2ging.com" },
    now: () => new Date("2026-10-01T16:00:05Z"),
    email: {
      transport: {
        name: "fake",
        send: async (m) => {
          sent.push(m);
          return { id: "msg-1" };
        },
      },
      to: "phillip@example.com",
      from: "SF2G Reports <onboarding@resend.dev>",
    },
    ...over,
  };
  return { d, sb, sent };
}

beforeEach(() => vi.clearAllMocks());

describe("month arithmetic", () => {
  it("reports the previous LA month, even just after midnight UTC", () => {
    // 2026-10-01 03:00 UTC is still Sept 30 in LA → report August? No:
    // the job runs at 16:00 UTC on the 1st, which is Oct 1 in LA → September.
    expect(previousMonth(new Date("2026-10-01T16:00:00Z"))).toBe("2026-09");
    // Early on the 1st UTC it is still the previous day in LA.
    expect(previousMonth(new Date("2026-10-01T03:00:00Z"))).toBe("2026-08");
    expect(previousMonth(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("runMonthlyReport", () => {
  it("renders, stores, then emails the previous month", async () => {
    const { d, sb, sent } = deps();
    const run = await runMonthlyReport({}, d);
    expect(run.status).toBe("sent");
    expect(run.month).toBe("2026-09");
    expect(run.subject).toContain("September 2026");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "phillip@example.com",
      subject: run.subject,
    });
    expect(sent[0].html).toContain("+25%"); // 8 → 10 rides
    const stored = sb.rows.get("2026-09-01")!;
    expect(stored.sent_to).toBe("phillip@example.com");
    expect(stored.sent_at).toBe("2026-10-01T16:00:05.000Z");
    expect(sb.rpc).toHaveBeenCalledWith("prune_app_errors", {
      p_keep: "90 days",
    });
  });

  it("does not send a month twice unless forced", async () => {
    const { d, sent } = deps();
    await runMonthlyReport({}, d);
    const again = await runMonthlyReport({}, d);
    expect(again.status).toBe("already_sent");
    expect(sent).toHaveLength(1);
    const forced = await runMonthlyReport({ force: true }, d);
    expect(forced.status).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("stores without sending when asked (dry) or when email is unconfigured", async () => {
    const { d, sent, sb } = deps();
    expect((await runMonthlyReport({ send: false }, d)).status).toBe("stored");
    expect(sent).toHaveLength(0);

    const { d: unconfigured, sb: sb2 } = deps({
      email: { transport: null, to: null, from: "x" },
    });
    const run = await runMonthlyReport({}, unconfigured);
    expect(run.status).toBe("stored");
    expect(run.error).toMatch(/RESEND_API_KEY/);
    expect(sb2.rows.get("2026-09-01")!.send_error).toMatch(/RESEND_API_KEY/);
    expect(sb.rows.get("2026-09-01")!.sent_at).toBeUndefined();
  });

  it("keeps the stored report and records the error when sending fails", async () => {
    const { d, sb } = deps({
      email: {
        transport: {
          name: "fake",
          send: async () => {
            throw new Error("Resend 422 validation_error: bad from");
          },
        },
        to: "phillip@example.com",
        from: "nope",
      },
    });
    const run = await runMonthlyReport({}, d);
    expect(run.status).toBe("send_failed");
    expect(run.error).toContain("Resend 422");
    expect(sb.rows.get("2026-09-01")!.send_error).toContain("Resend 422");
    const { reportError } = await import("../report-error");
    expect(reportError).toHaveBeenCalledWith(
      "monthly-report",
      expect.any(Error),
      expect.objectContaining({ month: "2026-09" }),
    );
  });

  it("accepts an explicit month", async () => {
    const { d } = deps();
    const run = await runMonthlyReport({ month: "2026-08", send: false }, d);
    expect(run.month).toBe("2026-08");
    expect(d.supabase.rpc).toHaveBeenCalledWith("get_monthly_report", {
      p_month: "2026-08-01",
    });
  });
});

describe("collectMonthlyReport — optional sources", () => {
  it("skips PostHog and Cloudflare when not configured", async () => {
    const { d } = deps();
    const data = await collectMonthlyReport("2026-09", d);
    expect(data.usage).toBeNull();
    expect(data.workers).toBeNull();
    expect(data.notes).toEqual([]);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("reads PostHog usage and Cloudflare metrics when configured", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("posthog.com")) {
        return new Response(
          JSON.stringify({
            columns: [
              "month",
              "pageviews",
              "visitors",
              "sessions",
              "client_errors",
            ],
            results: [
              ["2026-09", 120, 30, 50, 2],
              ["2026-08", 100, 25, 40, 5],
            ],
          }),
        );
      }
      if (u.includes("api.cloudflare.com")) {
        return new Response(
          JSON.stringify({
            data: {
              viewer: {
                accounts: [
                  {
                    workersInvocationsAdaptive: [
                      {
                        sum: { requests: 1000, errors: 3, subrequests: 2500 },
                        quantiles: { cpuTimeP50: 2100, cpuTimeP99: 9800 },
                      },
                    ],
                  },
                ],
              },
            },
          }),
        );
      }
      return new Response("not found", { status: 404 });
    });
    const { d } = deps({
      fetch: fetchMock as unknown as typeof fetch,
      env: {
        POSTHOG_PERSONAL_API_KEY: "phx_test",
        POSTHOG_PROJECT_ID: "113623",
        CLOUDFLARE_API_TOKEN: "cf_test",
        CLOUDFLARE_ACCOUNT_ID: "acct",
      },
    });
    const data = await collectMonthlyReport("2026-09", d);
    expect(data.usage?.months[0]).toEqual({
      month: "2026-09",
      pageviews: 120,
      visitors: 30,
      sessions: 50,
      client_errors: 2,
    });
    expect(data.workers?.months[0]).toMatchObject({
      month: "2026-09",
      requests: 1000,
      errors: 3,
      cpu_p50_ms: 2.1,
      cpu_p99_ms: 9.8,
    });
    expect(data.notes).toEqual([]);
    // 2 PostHog queries + 2 Cloudflare months
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const posthogCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("posthog"),
    );
    expect(String(posthogCall![0])).toBe(
      "https://us.posthog.com/api/projects/113623/query/",
    );
  });

  it("turns a failing optional source into a note, not a failure", async () => {
    const { d } = deps({
      fetch: vi.fn(
        async () => new Response("nope", { status: 401 }),
      ) as unknown as typeof fetch,
      env: { CLOUDFLARE_API_TOKEN: "bad", CLOUDFLARE_ACCOUNT_ID: "acct" },
    });
    const data = await collectMonthlyReport("2026-09", d);
    expect(data.workers).toBeNull();
    expect(data.notes[0]).toMatch(
      /Platform metrics unavailable: Cloudflare 401/,
    );
  });
});
