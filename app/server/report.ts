/**
 * Weekly / monthly report — collect, render, store, send.
 *
 * Runs from the Cron Triggers (wrangler.jsonc, app/ssr.tsx): Monday mornings
 * for the previous Monday–Sunday week, the 1st for the previous month. Also
 * from `POST /api/cron?task=weekly-report|monthly-report` and from the
 * DevTools panel (preview / send now). Periods are LA calendar periods
 * (app/lib/report.ts).
 *
 * Sources, in subrequests:
 *   1   get_report(kind, start)              — every community/health number
 *   0–2 PostHog HogQL (optional)             — page views, visitors, top pages
 *   0–2 Cloudflare GraphQL (optional)        — Worker requests, errors, CPU
 *   1   Resend (optional)                    — the email itself
 *   3–4 reports read/upsert, prune_app_errors
 * Optional sources that fail add a note to the report instead of failing it.
 *
 * Idempotent: a period that was already sent is not sent again unless forced.
 */
import { createServiceClient } from "../lib/supabase";
import {
  normalizePeriod,
  periodEnd,
  periodStart,
  previousPeriod,
  renderReport,
  shiftPeriod,
  yearAgoOffset,
  type DbReport,
  type ReportData,
  type ReportKind,
  type RenderedReport,
  type UsageReport,
  type WorkerReport,
} from "../lib/report";
import { OUTBOUND_FETCH_TIMEOUT_MS } from "../lib/constants";
import { errorMessage } from "../lib/errors";
import { emailConfigFromEnv, type EmailConfig } from "./email";
import { reportError } from "./report-error";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ReportDeps {
  supabase: ServiceClient;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  email: EmailConfig;
}

export interface ReportRun extends RenderedReport {
  kind: ReportKind;
  /** YYYY-MM for a month, the Monday YYYY-MM-DD for a week. */
  period: string;
  status: "sent" | "stored" | "already_sent" | "send_failed";
  sentTo: string | null;
  error: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** UTC instants bounding an LA calendar period, as ISO strings. */
function periodBoundsIso(
  kind: ReportKind,
  key: string,
): { from: string; to: string } {
  // LA is UTC−7/−8; widen by an hour each way and let the sources bucket in
  // LA time.
  const from = new Date(`${periodStart(kind, key)}T00:00:00-08:00`);
  const to = new Date(`${periodEnd(kind, key)}T00:00:00-07:00`);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// PostHog (optional)
// ---------------------------------------------------------------------------

async function hogql<T>(
  deps: ReportDeps,
  name: string,
  query: string,
): Promise<T[]> {
  const host = deps.env.POSTHOG_API_HOST ?? "https://us.posthog.com";
  const res = await deps.fetch(
    `${host}/api/projects/${deps.env.POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.env.POSTHOG_PERSONAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok)
    throw new Error(
      `PostHog ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as {
    results?: unknown[][];
    columns?: string[];
  };
  const cols = body.columns ?? [];
  return (body.results ?? []).map(
    (row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])) as T,
  );
}

/** HogQL expression bucketing an event into this kind's period key. */
function hogqlPeriod(kind: ReportKind): string {
  const la = "toTimeZone(timestamp, 'America/Los_Angeles')";
  return kind === "month"
    ? `formatDateTime(toStartOfMonth(${la}), '%Y-%m')`
    : `formatDateTime(toMonday(${la}), '%Y-%m-%d')`;
}

export async function fetchUsage(
  deps: ReportDeps,
  kind: ReportKind,
  key: string,
): Promise<UsageReport> {
  const cur = periodBoundsIso(kind, key);
  const prev2 = periodBoundsIso(kind, shiftPeriod(kind, key, -2));
  const lastYear = periodBoundsIso(
    kind,
    shiftPeriod(kind, key, -yearAgoOffset(kind)),
  );
  const inRange = `((timestamp >= toDateTime('${prev2.from}') AND timestamp < toDateTime('${cur.to}'))
      OR (timestamp >= toDateTime('${lastYear.from}') AND timestamp < toDateTime('${lastYear.to}')))`;

  type Row = {
    period: string;
    pageviews: number;
    visitors: number;
    sessions: number;
    client_errors: number;
  };
  const periods = await hogql<Row>(
    deps,
    `sf2g ${kind}ly report: usage`,
    `SELECT ${hogqlPeriod(kind)} AS period,
            countIf(event = '$pageview') AS pageviews,
            uniqIf(person_id, event = '$pageview') AS visitors,
            uniqIf(properties.$session_id, event = '$pageview') AS sessions,
            countIf(event = '$exception') AS client_errors
     FROM events
     WHERE ${inRange}
       AND event IN ('$pageview', '$exception')
     GROUP BY period
     ORDER BY period DESC`,
  );

  type PageRow = { path: string; views: number };
  const pages = await hogql<PageRow>(
    deps,
    `sf2g ${kind}ly report: top pages`,
    `SELECT replaceRegexpAll(properties.$pathname, '/profile/[^/]+', '/profile/:id') AS path,
            count() AS views
     FROM events
     WHERE timestamp >= toDateTime('${cur.from}') AND timestamp < toDateTime('${cur.to}')
       AND event = '$pageview'
       AND toDate(toTimeZone(timestamp, 'America/Los_Angeles')) >= toDate('${periodStart(kind, key)}')
       AND toDate(toTimeZone(timestamp, 'America/Los_Angeles')) < toDate('${periodEnd(kind, key)}')
     GROUP BY path
     ORDER BY views DESC
     LIMIT 8`,
  );

  return {
    periods: periods.map((r) => ({
      period: r.period,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
      sessions: Number(r.sessions),
      client_errors: Number(r.client_errors),
    })),
    top_pages: pages.map((p) => ({ path: p.path, views: Number(p.views) })),
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Workers metrics (optional; one period per query, 3 months kept)
// ---------------------------------------------------------------------------

const WORKERS_QUERY = `query SF2GReport($account: String!, $script: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 1000, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    }
  }
}`;

async function fetchWorkerPeriod(
  deps: ReportDeps,
  kind: ReportKind,
  key: string,
) {
  const { from, to } = periodBoundsIso(kind, key);
  const res = await deps.fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: WORKERS_QUERY,
      variables: {
        account: deps.env.CLOUDFLARE_ACCOUNT_ID,
        script: deps.env.CLOUDFLARE_WORKER_NAME ?? "sf2g",
        from,
        to,
      },
    }),
    signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(
      `Cloudflare ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const body = (await res.json()) as {
    errors?: Array<{ message: string }>;
    data?: {
      viewer: {
        accounts: Array<{
          workersInvocationsAdaptive: Array<{
            sum: { requests: number; errors: number; subrequests: number };
            quantiles: { cpuTimeP50: number; cpuTimeP99: number };
          }>;
        }>;
      };
    };
  };
  if (body.errors?.length)
    throw new Error(`Cloudflare GraphQL: ${body.errors[0].message}`);
  const rows = body.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
  const sum = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.sum.requests,
      errors: acc.errors + r.sum.errors,
      subrequests: acc.subrequests + r.sum.subrequests,
    }),
    { requests: 0, errors: 0, subrequests: 0 },
  );
  // Quantiles are per returned row; with no dimensions there is one row.
  const q = rows[0]?.quantiles;
  return {
    period: key,
    ...sum,
    cpu_p50_ms: q ? q.cpuTimeP50 / 1000 : null,
    cpu_p99_ms: q ? q.cpuTimeP99 / 1000 : null,
  };
}

export async function fetchWorkers(
  deps: ReportDeps,
  kind: ReportKind,
  key: string,
): Promise<WorkerReport> {
  const periods = await Promise.all([
    fetchWorkerPeriod(deps, kind, key),
    fetchWorkerPeriod(deps, kind, shiftPeriod(kind, key, -1)),
  ]);
  return { periods };
}

// ---------------------------------------------------------------------------
// Collect + render
// ---------------------------------------------------------------------------

export async function collectReport(
  kind: ReportKind,
  key: string,
  deps: ReportDeps,
): Promise<ReportData> {
  const notes: string[] = [];
  const { data, error } = await deps.supabase.rpc("get_report", {
    p_kind: kind,
    p_start: periodStart(kind, key),
  });
  if (error) throw new Error(`get_report: ${error.message}`);
  const db = data as unknown as DbReport;

  let usage: UsageReport | null = null;
  if (deps.env.POSTHOG_PERSONAL_API_KEY && deps.env.POSTHOG_PROJECT_ID) {
    try {
      usage = await fetchUsage(deps, kind, key);
    } catch (err) {
      notes.push(`Site usage unavailable: ${errorMessage(err)}`);
    }
  }

  let workers: WorkerReport | null = null;
  if (deps.env.CLOUDFLARE_API_TOKEN && deps.env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      workers = await fetchWorkers(deps, kind, key);
    } catch (err) {
      notes.push(`Platform metrics unavailable: ${errorMessage(err)}`);
    }
  }

  return {
    db,
    usage,
    workers,
    notes,
    siteUrl: deps.env.APP_URL?.replace(/\/$/, "") || "https://sf2ging.com",
  };
}

export interface RunOptions {
  kind: ReportKind;
  /**
   * YYYY-MM for a month, YYYY-MM-DD (any day of the week) for a week;
   * default: the previous LA period.
   */
  period?: string;
  /** Email it (default true). false = render and store only. */
  send?: boolean;
  /** Send even if this period was already sent. */
  force?: boolean;
}

export async function runReport(
  opts: RunOptions,
  deps: ReportDeps,
): Promise<ReportRun> {
  const { kind } = opts;
  const period = opts.period
    ? normalizePeriod(kind, opts.period)
    : previousPeriod(kind, deps.now());
  const send = opts.send ?? true;
  const key = periodStart(kind, period);

  if (send && !opts.force) {
    const { data: existing } = await deps.supabase
      .from("reports")
      .select("subject, html, text, sent_to, sent_at")
      .eq("kind", kind)
      .eq("period_start", key)
      .maybeSingle();
    if (existing?.sent_at) {
      return {
        kind,
        period,
        status: "already_sent",
        subject: existing.subject,
        html: existing.html,
        text: existing.text,
        sentTo: existing.sent_to,
        error: null,
        notes: [],
      };
    }
  }

  const data = await collectReport(kind, period, deps);
  const rendered = renderReport(data);

  const { error: upsertError } = await deps.supabase.from("reports").upsert(
    {
      kind,
      period_start: key,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      data: data as never,
      generated_at: deps.now().toISOString(),
    },
    { onConflict: "kind,period_start" },
  );
  if (upsertError) throw new Error(`reports upsert: ${upsertError.message}`);

  const base = { kind, period, ...rendered, notes: data.notes };
  if (!send) return { ...base, status: "stored", sentTo: null, error: null };

  const { transport, to, from } = deps.email;
  if (!transport || !to) {
    const error = !transport
      ? "Email not configured: set RESEND_API_KEY and REPORT_EMAIL_TO"
      : "REPORT_EMAIL_TO is not set";
    await deps.supabase
      .from("reports")
      .update({ send_error: error })
      .eq("kind", kind)
      .eq("period_start", key);
    return { ...base, status: "stored", sentTo: null, error };
  }

  try {
    await transport.send({ to, from, ...rendered });
    await deps.supabase
      .from("reports")
      .update({
        sent_to: to,
        sent_at: deps.now().toISOString(),
        send_error: null,
      })
      .eq("kind", kind)
      .eq("period_start", key);
    // Retention for the error table; a failure here must not fail the run.
    await deps.supabase.rpc("prune_app_errors", { p_keep: "90 days" });
    return { ...base, status: "sent", sentTo: to, error: null };
  } catch (err) {
    const error = errorMessage(err);
    await deps.supabase
      .from("reports")
      .update({ send_error: error })
      .eq("kind", kind)
      .eq("period_start", key);
    await reportError("report", err, {
      kind,
      period,
      transport: transport.name,
    });
    return { ...base, status: "send_failed", sentTo: null, error };
  }
}

export function defaultReportDeps(): ReportDeps {
  return {
    supabase: createServiceClient(),
    fetch: (...args) => fetch(...args),
    env: process.env,
    now: () => new Date(),
    email: emailConfigFromEnv(),
  };
}

/** The Cron Trigger entry point. */
export async function runReportTick(kind: ReportKind): Promise<ReportRun> {
  const run = await runReport({ kind }, defaultReportDeps());
  console.log(
    `[report] ${run.kind} ${run.period} ${run.status}${run.sentTo ? ` → ${run.sentTo}` : ""}${run.error ? ` (${run.error})` : ""}`,
  );
  return run;
}
