/**
 * Monthly report — collect, render, store, send.
 *
 * Runs from the Cron Trigger on the 1st of each month (wrangler.jsonc,
 * app/ssr.tsx), from `POST /api/cron?task=monthly-report`, and from the
 * DevTools panel (preview / send now). The report covers the previous LA
 * calendar month.
 *
 * Sources, in subrequests:
 *   1   get_monthly_report(month)           — every community/health number
 *   0–2 PostHog HogQL (optional)            — page views, visitors, top pages
 *   0–2 Cloudflare GraphQL (optional)       — Worker requests, errors, CPU
 *   1   Resend (optional)                   — the email itself
 *   3–4 monthly_reports read/upsert, prune_app_errors
 * Optional sources that fail add a note to the report instead of failing it.
 *
 * Idempotent: a month that was already sent is not sent again unless forced.
 */
import { createServiceClient } from "../lib/supabase";
import { localDate } from "../lib/dates";
import {
  renderMonthlyReport,
  type DbReport,
  type MonthlyReportData,
  type RenderedReport,
  type UsageReport,
  type WorkerReport,
} from "../lib/monthly-report";
import { OUTBOUND_FETCH_TIMEOUT_MS } from "../lib/constants";
import { errorMessage } from "../lib/errors";
import { emailConfigFromEnv, type EmailConfig } from "./email";
import { reportError } from "./report-error";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface MonthlyReportDeps {
  supabase: ServiceClient;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  email: EmailConfig;
}

export interface MonthlyReportRun extends RenderedReport {
  /** YYYY-MM */
  month: string;
  status: "sent" | "stored" | "already_sent" | "send_failed";
  sentTo: string | null;
  error: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Dates (LA calendar months)
// ---------------------------------------------------------------------------

/** "2026-10" → "2026-10-01" */
export function monthStart(yyyyMm: string): string {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm)) throw new Error(`Bad month: ${yyyyMm}`);
  return `${yyyyMm}-01`;
}

export function shiftMonth(yyyyMm: string, months: number): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month the report covers when run at `now`: the previous LA month. */
export function previousMonth(now: Date): string {
  return shiftMonth(localDate(now).slice(0, 7), -1);
}

/** UTC instants bounding an LA calendar month, as ISO strings. */
function monthBoundsIso(yyyyMm: string): { from: string; to: string } {
  // LA is UTC−7/−8; widen by a day and let the sources bucket in LA time.
  const from = new Date(`${monthStart(yyyyMm)}T00:00:00-08:00`);
  const to = new Date(`${monthStart(shiftMonth(yyyyMm, 1))}T00:00:00-07:00`);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// PostHog (optional)
// ---------------------------------------------------------------------------

async function hogql<T>(
  deps: MonthlyReportDeps,
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

export async function fetchUsage(
  deps: MonthlyReportDeps,
  month: string,
): Promise<UsageReport> {
  const cur = monthBoundsIso(month);
  const prev2 = monthBoundsIso(shiftMonth(month, -2));
  const lastYear = monthBoundsIso(shiftMonth(month, -12));
  const inRange = `((timestamp >= toDateTime('${prev2.from}') AND timestamp < toDateTime('${cur.to}'))
      OR (timestamp >= toDateTime('${lastYear.from}') AND timestamp < toDateTime('${lastYear.to}')))`;

  type Row = {
    month: string;
    pageviews: number;
    visitors: number;
    sessions: number;
    client_errors: number;
  };
  const months = await hogql<Row>(
    deps,
    "sf2g monthly report: usage",
    `SELECT formatDateTime(toStartOfMonth(toTimeZone(timestamp, 'America/Los_Angeles')), '%Y-%m') AS month,
            countIf(event = '$pageview') AS pageviews,
            uniqIf(person_id, event = '$pageview') AS visitors,
            uniqIf(properties.$session_id, event = '$pageview') AS sessions,
            countIf(event = '$exception') AS client_errors
     FROM events
     WHERE ${inRange}
       AND event IN ('$pageview', '$exception')
     GROUP BY month
     ORDER BY month DESC`,
  );

  type PageRow = { path: string; views: number };
  const pages = await hogql<PageRow>(
    deps,
    "sf2g monthly report: top pages",
    `SELECT replaceRegexpAll(properties.$pathname, '/profile/[^/]+', '/profile/:id') AS path,
            count() AS views
     FROM events
     WHERE timestamp >= toDateTime('${cur.from}') AND timestamp < toDateTime('${cur.to}')
       AND event = '$pageview'
       AND toStartOfMonth(toTimeZone(timestamp, 'America/Los_Angeles')) = toDate('${monthStart(month)}')
     GROUP BY path
     ORDER BY views DESC
     LIMIT 8`,
  );

  return {
    months: months.map((r) => ({
      month: r.month,
      pageviews: Number(r.pageviews),
      visitors: Number(r.visitors),
      sessions: Number(r.sessions),
      client_errors: Number(r.client_errors),
    })),
    top_pages: pages.map((p) => ({ path: p.path, views: Number(p.views) })),
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Workers metrics (optional; one month per query, 3 months kept)
// ---------------------------------------------------------------------------

const WORKERS_QUERY = `query SF2GMonthly($account: String!, $script: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 1000, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    }
  }
}`;

async function fetchWorkerMonth(deps: MonthlyReportDeps, month: string) {
  const { from, to } = monthBoundsIso(month);
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
    month,
    ...sum,
    cpu_p50_ms: q ? q.cpuTimeP50 / 1000 : null,
    cpu_p99_ms: q ? q.cpuTimeP99 / 1000 : null,
  };
}

export async function fetchWorkers(
  deps: MonthlyReportDeps,
  month: string,
): Promise<WorkerReport> {
  const months = await Promise.all([
    fetchWorkerMonth(deps, month),
    fetchWorkerMonth(deps, shiftMonth(month, -1)),
  ]);
  return { months };
}

// ---------------------------------------------------------------------------
// Collect + render
// ---------------------------------------------------------------------------

export async function collectMonthlyReport(
  month: string,
  deps: MonthlyReportDeps,
): Promise<MonthlyReportData> {
  const notes: string[] = [];
  const { data, error } = await deps.supabase.rpc("get_monthly_report", {
    p_month: monthStart(month),
  });
  if (error) throw new Error(`get_monthly_report: ${error.message}`);
  const db = data as unknown as DbReport;

  let usage: UsageReport | null = null;
  if (deps.env.POSTHOG_PERSONAL_API_KEY && deps.env.POSTHOG_PROJECT_ID) {
    try {
      usage = await fetchUsage(deps, month);
    } catch (err) {
      notes.push(`Site usage unavailable: ${errorMessage(err)}`);
    }
  }

  let workers: WorkerReport | null = null;
  if (deps.env.CLOUDFLARE_API_TOKEN && deps.env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      workers = await fetchWorkers(deps, month);
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
  /** YYYY-MM; default: the previous LA month. */
  month?: string;
  /** Email it (default true). false = render and store only. */
  send?: boolean;
  /** Send even if this month was already sent. */
  force?: boolean;
}

export async function runMonthlyReport(
  opts: RunOptions,
  deps: MonthlyReportDeps,
): Promise<MonthlyReportRun> {
  const month = opts.month ?? previousMonth(deps.now());
  const send = opts.send ?? true;
  const key = monthStart(month);

  if (send && !opts.force) {
    const { data: existing } = await deps.supabase
      .from("monthly_reports")
      .select("subject, html, text, sent_to, sent_at")
      .eq("month", key)
      .maybeSingle();
    if (existing?.sent_at) {
      return {
        month,
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

  const data = await collectMonthlyReport(month, deps);
  const rendered = renderMonthlyReport(data);

  const { error: upsertError } = await deps.supabase
    .from("monthly_reports")
    .upsert(
      {
        month: key,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        data: data as never,
        generated_at: deps.now().toISOString(),
      },
      { onConflict: "month" },
    );
  if (upsertError)
    throw new Error(`monthly_reports upsert: ${upsertError.message}`);

  const base = { month, ...rendered, notes: data.notes };
  if (!send) return { ...base, status: "stored", sentTo: null, error: null };

  const { transport, to, from } = deps.email;
  if (!transport || !to) {
    const error = !transport
      ? "Email not configured: set RESEND_API_KEY and REPORT_EMAIL_TO"
      : "REPORT_EMAIL_TO is not set";
    await deps.supabase
      .from("monthly_reports")
      .update({ send_error: error })
      .eq("month", key);
    return { ...base, status: "stored", sentTo: null, error };
  }

  try {
    await transport.send({ to, from, ...rendered });
    await deps.supabase
      .from("monthly_reports")
      .update({
        sent_to: to,
        sent_at: deps.now().toISOString(),
        send_error: null,
      })
      .eq("month", key);
    // Retention for the error table; a failure here must not fail the run.
    await deps.supabase.rpc("prune_app_errors", { p_keep: "90 days" });
    return { ...base, status: "sent", sentTo: to, error: null };
  } catch (err) {
    const error = errorMessage(err);
    await deps.supabase
      .from("monthly_reports")
      .update({ send_error: error })
      .eq("month", key);
    await reportError("monthly-report", err, {
      month,
      transport: transport.name,
    });
    return { ...base, status: "send_failed", sentTo: null, error };
  }
}

export function defaultMonthlyReportDeps(): MonthlyReportDeps {
  return {
    supabase: createServiceClient(),
    fetch: (...args) => fetch(...args),
    env: process.env,
    now: () => new Date(),
    email: emailConfigFromEnv(),
  };
}

/** The Cron Trigger entry point. */
export async function runMonthlyReportTick(): Promise<MonthlyReportRun> {
  const run = await runMonthlyReport({}, defaultMonthlyReportDeps());
  console.log(
    `[monthly-report] ${run.month} ${run.status}${run.sentTo ? ` → ${run.sentTo}` : ""}${run.error ? ` (${run.error})` : ""}`,
  );
  return run;
}
