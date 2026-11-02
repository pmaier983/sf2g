/**
 * Phase 08 (+ weekly): the report run — period selection, idempotency,
 * storing before sending, and how optional sources and email failures are
 * handled. Supabase, PostHog, Cloudflare and Resend are all faked at the
 * edges.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectReport, runReport, type ReportDeps } from "../report";
import type { EmailMessage } from "../email";

vi.mock("../report-error", () => ({
  reportError: vi.fn(async () => "recorded"),
}));

const PERIOD_ROW = {
  other_rides: 1,
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
};

const REST = {
  generated_at: "2026-10-01T16:00:00Z",
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

const MONTH_REPORT = {
  kind: "month",
  period: "2026-09",
  periods: [
    {
      period: "2026-09",
      offset: 0,
      sf2g_rides: 10,
      active_riders: 4,
      ...PERIOD_ROW,
    },
    {
      period: "2026-08",
      offset: 1,
      sf2g_rides: 8,
      active_riders: 3,
      ...PERIOD_ROW,
    },
  ],
  ...REST,
};

const WEEK_REPORT = {
  kind: "week",
  period: "2026-10-19",
  periods: [
    {
      period: "2026-10-19",
      offset: 0,
      sf2g_rides: 12,
      active_riders: 5,
      ...PERIOD_ROW,
    },
    {
      period: "2026-10-12",
      offset: 1,
      sf2g_rides: 8,
      active_riders: 3,
      ...PERIOD_ROW,
    },
  ],
  ...REST,
};

/** Minimal in-memory stand-in for the Supabase calls the run makes. */
function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();
  const keyOf = (kind: unknown, start: unknown) => `${kind}:${start}`;
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "get_report")
      return {
        data: args.p_kind === "week" ? WEEK_REPORT : MONTH_REPORT,
        error: null,
      };
    if (fn === "prune_app_errors") return { data: 0, error: null };
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  });
  const from = vi.fn((table: string) => {
    if (table !== "reports") throw new Error(`unexpected table ${table}`);
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        filters[c] = v;
        return chain;
      },
      maybeSingle: async () => ({
        data: rows.get(keyOf(filters.kind, filters.period_start)) ?? null,
        error: null,
      }),
      upsert: async (row: Record<string, unknown>) => {
        const k = keyOf(row.kind, row.period_start);
        rows.set(k, { ...rows.get(k), ...row });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        const upd = {
          eq: (c: string, v: unknown) => {
            filters[c] = v;
            return upd;
          },
          then: (resolve: (v: { error: null }) => void) => {
            const k = keyOf(filters.kind, filters.period_start);
            rows.set(k, { ...rows.get(k), ...patch });
            resolve({ error: null });
          },
        };
        return upd;
      },
    };
    return chain;
  });
  return {
    client: { rpc, from } as unknown as ReportDeps["supabase"],
    rows,
    rpc,
  };
}

function deps(over: Partial<ReportDeps> = {}, sent: EmailMessage[] = []) {
  const sb = fakeSupabase();
  const d: ReportDeps = {
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

describe("runReport (month)", () => {
  it("renders, stores, then emails the previous month", async () => {
    const { d, sb, sent } = deps();
    const run = await runReport({ kind: "month" }, d);
    expect(run.status).toBe("sent");
    expect(run.kind).toBe("month");
    expect(run.period).toBe("2026-09");
    expect(run.subject).toContain("September 2026");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "phillip@example.com",
      subject: run.subject,
    });
    expect(sent[0].html).toContain("+25%"); // 8 → 10 rides
    const stored = sb.rows.get("month:2026-09-01")!;
    expect(stored.sent_to).toBe("phillip@example.com");
    expect(stored.sent_at).toBe("2026-10-01T16:00:05.000Z");
    expect(sb.rpc).toHaveBeenCalledWith("prune_app_errors", {
      p_keep: "90 days",
    });
  });

  it("does not send a period twice unless forced", async () => {
    const { d, sent } = deps();
    await runReport({ kind: "month" }, d);
    const again = await runReport({ kind: "month" }, d);
    expect(again.status).toBe("already_sent");
    expect(sent).toHaveLength(1);
    const forced = await runReport({ kind: "month", force: true }, d);
    expect(forced.status).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("stores without sending when asked (dry) or when email is unconfigured", async () => {
    const { d, sent, sb } = deps();
    expect((await runReport({ kind: "month", send: false }, d)).status).toBe(
      "stored",
    );
    expect(sent).toHaveLength(0);

    const { d: unconfigured, sb: sb2 } = deps({
      email: { transport: null, to: null, from: "x" },
    });
    const run = await runReport({ kind: "month" }, unconfigured);
    expect(run.status).toBe("stored");
    expect(run.error).toMatch(/RESEND_API_KEY/);
    expect(sb2.rows.get("month:2026-09-01")!.send_error).toMatch(
      /RESEND_API_KEY/,
    );
    expect(sb.rows.get("month:2026-09-01")!.sent_at).toBeUndefined();
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
    const run = await runReport({ kind: "month" }, d);
    expect(run.status).toBe("send_failed");
    expect(run.error).toContain("Resend 422");
    expect(sb.rows.get("month:2026-09-01")!.send_error).toContain("Resend 422");
    const { reportError } = await import("../report-error");
    expect(reportError).toHaveBeenCalledWith(
      "report",
      expect.any(Error),
      expect.objectContaining({ kind: "month", period: "2026-09" }),
    );
  });

  it("accepts an explicit month", async () => {
    const { d } = deps();
    const run = await runReport(
      { kind: "month", period: "2026-08", send: false },
      d,
    );
    expect(run.period).toBe("2026-08");
    expect(d.supabase.rpc).toHaveBeenCalledWith("get_report", {
      p_kind: "month",
      p_start: "2026-08-01",
    });
  });

  it("rejects a period that does not match the kind", async () => {
    const { d } = deps();
    await expect(
      runReport({ kind: "month", period: "2026-08-03" }, d),
    ).rejects.toThrow(/YYYY-MM/);
    await expect(
      runReport({ kind: "week", period: "2026-08" }, d),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("runReport (week)", () => {
  it("emails the previous Monday-to-Sunday week, keyed by its Monday", async () => {
    const { d, sb, sent } = deps({
      // Monday Oct 26 2026, 9 am LA.
      now: () => new Date("2026-10-26T16:00:05Z"),
    });
    const run = await runReport({ kind: "week" }, d);
    expect(run.status).toBe("sent");
    expect(run.kind).toBe("week");
    expect(run.period).toBe("2026-10-19");
    expect(run.subject).toContain("week of Oct 19");
    expect(sent[0].html).toContain("+50%"); // 8 → 12 rides
    expect(d.supabase.rpc).toHaveBeenCalledWith("get_report", {
      p_kind: "week",
      p_start: "2026-10-19",
    });
    expect(sb.rows.get("week:2026-10-19")).toMatchObject({
      kind: "week",
      period_start: "2026-10-19",
      sent_to: "phillip@example.com",
    });
    // A week and a month are tracked separately.
    expect(sb.rows.has("month:2026-09-01")).toBe(false);
  });

  it("snaps an explicit date to the Monday of its week", async () => {
    const { d } = deps();
    const run = await runReport(
      { kind: "week", period: "2026-10-22", send: false },
      d,
    );
    expect(run.period).toBe("2026-10-19");
    expect(d.supabase.rpc).toHaveBeenCalledWith("get_report", {
      p_kind: "week",
      p_start: "2026-10-19",
    });
  });
});

describe("collectReport — optional sources", () => {
  it("skips PostHog and Cloudflare when not configured", async () => {
    const { d } = deps();
    const data = await collectReport("month", "2026-09", d);
    expect(data.usage).toBeNull();
    expect(data.workers).toBeNull();
    expect(data.notes).toEqual([]);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  function configuredFetch() {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes("posthog.com")) {
        return new Response(
          JSON.stringify({
            columns: [
              "period",
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
  }

  const CONFIGURED_ENV = {
    POSTHOG_PERSONAL_API_KEY: "phx_test",
    POSTHOG_PROJECT_ID: "113623",
    CLOUDFLARE_API_TOKEN: "cf_test",
    CLOUDFLARE_ACCOUNT_ID: "acct",
  };

  it("reads PostHog usage and Cloudflare metrics when configured", async () => {
    const fetchMock = configuredFetch();
    const { d } = deps({
      fetch: fetchMock as unknown as typeof fetch,
      env: CONFIGURED_ENV,
    });
    const data = await collectReport("month", "2026-09", d);
    expect(data.usage?.periods[0]).toEqual({
      period: "2026-09",
      pageviews: 120,
      visitors: 30,
      sessions: 50,
      client_errors: 2,
    });
    expect(data.workers?.periods[0]).toMatchObject({
      period: "2026-09",
      requests: 1000,
      errors: 3,
      cpu_p50_ms: 2.1,
      cpu_p99_ms: 9.8,
    });
    expect(data.notes).toEqual([]);
    // 2 PostHog queries + 2 Cloudflare periods
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const posthogCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("posthog"),
    );
    expect(String(posthogCall![0])).toBe(
      "https://us.posthog.com/api/projects/113623/query/",
    );
    const query = JSON.parse(String(posthogCall![1]!.body)).query.query;
    expect(query).toContain("toStartOfMonth");
  });

  it("buckets PostHog usage by Monday weeks for a weekly report", async () => {
    const fetchMock = configuredFetch();
    const { d } = deps({
      fetch: fetchMock as unknown as typeof fetch,
      env: CONFIGURED_ENV,
    });
    await collectReport("week", "2026-10-19", d);
    const bodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes("posthog"))
      .map((c) => JSON.parse(String(c[1]!.body)).query.query as string);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("toMonday");
    expect(bodies[0]).not.toContain("toStartOfMonth");
    // The window covers the three reported weeks and the week a year ago.
    expect(bodies[0]).toContain("2026-10-05");
    expect(bodies[0]).toContain("2025-10-20");
    const cf = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes("cloudflare"))
      .map((c) => JSON.parse(String(c[1]!.body)).variables);
    expect(cf.map((v) => v.from.slice(0, 10))).toEqual([
      "2026-10-19",
      "2026-10-12",
    ]);
  });

  it("turns a failing optional source into a note, not a failure", async () => {
    const { d } = deps({
      fetch: vi.fn(
        async () => new Response("nope", { status: 401 }),
      ) as unknown as typeof fetch,
      env: { CLOUDFLARE_API_TOKEN: "bad", CLOUDFLARE_ACCOUNT_ID: "acct" },
    });
    const data = await collectReport("month", "2026-09", d);
    expect(data.workers).toBeNull();
    expect(data.notes[0]).toMatch(
      /Platform metrics unavailable: Cloudflare 401/,
    );
  });
});
