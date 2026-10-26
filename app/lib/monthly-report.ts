/**
 * Monthly report — pure rendering.
 *
 * `MonthlyReportData` is assembled on the server (app/server/monthly-report.ts)
 * from one SQL call (`get_monthly_report`, migration 044) plus optional
 * PostHog usage and Cloudflare Workers metrics. This module turns it into an
 * email: subject, HTML and plain text. No I/O, fully unit-tested.
 */

// ---------------------------------------------------------------------------
// Data shapes (the `db` part mirrors get_monthly_report's JSON exactly)
// ---------------------------------------------------------------------------

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  /** 0 = reported month, 1 and 2 = the months before, 12 = a year earlier */
  offset: number;
  sf2g_rides: number;
  other_rides: number;
  active_riders: number;
  sf2g_distance_meters: number;
  sf2g_elevation_meters: number;
  sf2g_moving_seconds: number;
  routes: Record<string, number>;
  new_riders: number;
  group_rides: number;
  biggest_group: number;
  sync_jobs_done: number;
  sync_jobs_failed: number;
  errors: number;
}

export interface TopRider {
  user_id: string;
  display_name: string | null;
  rides: number;
  distance_meters: number;
}

export interface DbReport {
  month: string;
  generated_at: string;
  months: MonthRow[];
  top_riders: TopRider[];
  riders: {
    connected: number;
    needs_reauth: number;
    synced_last_7_days: number;
    never_synced: number;
  };
  sync: {
    open_jobs: number;
    failed_jobs_open: number;
    top_errors: Array<{ message: string; count: number }>;
  };
  errors: {
    top: Array<{
      scope: string;
      fingerprint: string;
      message: string;
      count: number;
      last_seen: string;
    }>;
  };
  all_time: {
    sf2g_rides: number;
    riders_with_rides: number;
    sf2g_distance_meters: number;
  };
}

/** From PostHog (optional). One row per month, same offsets as `db.months`. */
export interface UsageMonth {
  month: string;
  pageviews: number;
  visitors: number;
  sessions: number;
  client_errors: number;
}

export interface UsageReport {
  months: UsageMonth[];
  top_pages: Array<{ path: string; views: number }>;
}

/** From Cloudflare's GraphQL analytics (optional). */
export interface WorkerMonth {
  month: string;
  requests: number;
  errors: number;
  subrequests: number;
  cpu_p50_ms: number | null;
  cpu_p99_ms: number | null;
}

export interface WorkerReport {
  months: WorkerMonth[];
}

export interface MonthlyReportData {
  db: DbReport;
  usage: UsageReport | null;
  workers: WorkerReport | null;
  /** Things the reader should know: integrations not configured, failures. */
  notes: string[];
  /** Where the site lives, for links. */
  siteUrl: string;
}

export interface RenderedReport {
  subject: string;
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers (exported for tests)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
  bayway: "Bayway",
  skyline: "Skyline",
  hmbw: "HMBW",
  royale: "Royale",
  fleaway: "Fleaway",
  mebw: "MEBW",
  febw: "FEBW",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09" → "September 2026" */
export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? yyyyMm} ${y}`;
}

/** "2026-09" → "Sep" */
export function monthShort(yyyyMm: string): string {
  const m = Number(yyyyMm.split("-")[1]);
  return (MONTHS[m - 1] ?? yyyyMm).slice(0, 3);
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtKmMi(meters: number): string {
  const km = meters / 1000;
  const mi = meters / 1609.344;
  return `${fmtInt(km)} km / ${fmtInt(mi)} mi`;
}

export function fmtMFt(meters: number): string {
  return `${fmtInt(meters)} m / ${fmtInt(meters * 3.28084)} ft`;
}

export function fmtHours(seconds: number): string {
  return `${fmtInt(seconds / 3600)} h`;
}

export function fmtPct(numerator: number, denominator: number): string {
  if (!denominator) return "–";
  return `${((100 * numerator) / denominator).toFixed(2)}%`;
}

export interface Delta {
  /** "+12%", "−8%", "new" (prev was 0), or "=" */
  label: string;
  direction: "up" | "down" | "flat" | "new";
}

/** Change from `prev` to `cur`, as people read it in an email. */
export function delta(cur: number, prev: number | undefined | null): Delta {
  if (prev === undefined || prev === null)
    return { label: "–", direction: "flat" };
  if (prev === 0) {
    return cur === 0
      ? { label: "=", direction: "flat" }
      : { label: "new", direction: "new" };
  }
  // Round the magnitude so −37.5% reads −38%, not −37%.
  const raw = ((cur - prev) / prev) * 100;
  const pct = Math.round(Math.abs(raw));
  if (pct === 0) return { label: "=", direction: "flat" };
  return raw > 0
    ? { label: `+${pct}%`, direction: "up" }
    : { label: `−${pct}%`, direction: "down" };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function byOffset<T extends { month: string }>(
  rows: T[],
  months: MonthRow[],
  offset: number,
): T | undefined {
  const m = months.find((r) => r.offset === offset)?.month;
  return m ? rows.find((r) => r.month === m) : undefined;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const COLOR = {
  text: "#1f2328",
  muted: "#656d76",
  border: "#d0d7de",
  accent: "#fc4c02",
  up: "#1a7f37",
  down: "#cf222e",
  bg: "#f6f8fa",
};

function deltaHtml(d: Delta): string {
  const color =
    d.direction === "up" || d.direction === "new"
      ? COLOR.up
      : d.direction === "down"
        ? COLOR.down
        : COLOR.muted;
  return `<span style="color:${color};font-weight:600">${escapeHtml(d.label)}</span>`;
}

function tile(label: string, value: string, sub: string): string {
  return `<td style="padding:12px 14px;border:1px solid ${COLOR.border};border-radius:8px;vertical-align:top;width:33%">
  <div style="font-size:12px;color:${COLOR.muted};text-transform:uppercase;letter-spacing:.04em">${escapeHtml(label)}</div>
  <div style="font-size:24px;font-weight:700;color:${COLOR.text};margin-top:4px">${value}</div>
  <div style="font-size:12px;color:${COLOR.muted};margin-top:4px">${sub}</div>
</td>`;
}

function section(title: string, body: string): string {
  return `<h2 style="font-size:16px;margin:28px 0 8px;color:${COLOR.text}">${escapeHtml(title)}</h2>${body}`;
}

function table(
  headers: string[],
  rows: string[][],
  align: ("l" | "r")[] = [],
): string {
  const th = headers
    .map(
      (h, i) =>
        `<th style="text-align:${align[i] === "r" ? "right" : "left"};padding:6px 8px;border-bottom:2px solid ${COLOR.border};font-size:12px;color:${COLOR.muted}">${escapeHtml(h)}</th>`,
    )
    .join("");
  const trs = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (c, i) =>
              `<td style="text-align:${align[i] === "r" ? "right" : "left"};padding:6px 8px;border-bottom:1px solid ${COLOR.border};font-size:14px">${c}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function compareCells(
  cur: number,
  prev?: MonthRow | UsageMonth | WorkerMonth,
  key?: string,
): string[] {
  const p =
    prev && key ? (prev as unknown as Record<string, number>)[key] : undefined;
  return [fmtInt(cur), fmtInt(p), deltaHtml(delta(cur, p))];
}

export function renderMonthlyReport(data: MonthlyReportData): RenderedReport {
  const { db } = data;
  const cur = db.months.find((m) => m.offset === 0);
  if (!cur) throw new Error("monthly report: no row for the reported month");
  const prev = db.months.find((m) => m.offset === 1);
  const prev2 = db.months.find((m) => m.offset === 2);
  const lastYear = db.months.find((m) => m.offset === 12);
  const label = monthLabel(cur.month);

  const ridesDelta = delta(cur.sf2g_rides, prev?.sf2g_rides);
  const subject = `SF2G ${label}: ${fmtInt(cur.sf2g_rides)} SF2G rides (${ridesDelta.label} vs ${prev ? monthShort(prev.month) : "last month"}), ${fmtInt(cur.active_riders)} riders`;

  const vsPrev = (k: keyof MonthRow) =>
    `${deltaHtml(delta(cur[k] as number, prev?.[k] as number | undefined))} vs ${prev ? monthShort(prev.month) : "–"}` +
    (lastYear
      ? ` · ${deltaHtml(delta(cur[k] as number, lastYear[k] as number))} vs ${monthShort(lastYear.month)} ${lastYear.month.slice(0, 4)}`
      : "");

  // --- Headline tiles -----------------------------------------------------
  const tiles = `<table cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>
${tile("SF2G rides", fmtInt(cur.sf2g_rides), vsPrev("sf2g_rides"))}
${tile("Active riders", fmtInt(cur.active_riders), vsPrev("active_riders"))}
${tile("New riders", fmtInt(cur.new_riders), vsPrev("new_riders"))}
</tr><tr>
${tile("Distance", fmtKmMi(cur.sf2g_distance_meters), vsPrev("sf2g_distance_meters"))}
${tile("Climbing", fmtMFt(cur.sf2g_elevation_meters), vsPrev("sf2g_elevation_meters"))}
${tile("Time in the saddle", fmtHours(cur.sf2g_moving_seconds), vsPrev("sf2g_moving_seconds"))}
</tr></table>`;

  // --- Routes -------------------------------------------------------------
  const routeRows = Object.keys(ROUTE_LABELS)
    .map((r) => ({ r, n: cur.routes[r] ?? 0, p: prev?.routes[r] ?? 0 }))
    .filter((x) => x.n > 0 || x.p > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => [
      escapeHtml(ROUTE_LABELS[x.r]),
      fmtInt(x.n),
      fmtInt(x.p),
      deltaHtml(delta(x.n, x.p)),
    ]);
  const routesHtml = routeRows.length
    ? table(
        [
          "Corridor",
          label.split(" ")[0],
          prev ? monthShort(prev.month) : "–",
          "Change",
        ],
        routeRows,
        ["l", "r", "r", "r"],
      )
    : `<p style="color:${COLOR.muted}">No SF2G rides this month.</p>`;

  // --- Riders of the month -------------------------------------------------
  const topHtml = db.top_riders.length
    ? table(
        ["Rider", "SF2G rides", "Distance"],
        db.top_riders.map((t) => [
          `<a href="${escapeHtml(data.siteUrl)}/profile/${escapeHtml(t.user_id)}" style="color:${COLOR.accent}">${escapeHtml(t.display_name ?? "Anonymous")}</a>`,
          fmtInt(t.rides),
          fmtKmMi(t.distance_meters),
        ]),
        ["l", "r", "r"],
      )
    : `<p style="color:${COLOR.muted}">Nobody rode an SF2G route this month.</p>`;

  // --- Group rides ----------------------------------------------------------
  const groupsHtml = table(
    ["", label.split(" ")[0], prev ? monthShort(prev.month) : "–", "Change"],
    [
      ["Group rides", ...compareCells(cur.group_rides, prev, "group_rides")],
      [
        "Biggest group (riders)",
        ...compareCells(cur.biggest_group, prev, "biggest_group"),
      ],
      [
        "Non-SF2G rides synced",
        ...compareCells(cur.other_rides, prev, "other_rides"),
      ],
    ],
    ["l", "r", "r", "r"],
  );

  // --- Site usage (PostHog) -------------------------------------------------
  let usageHtml: string;
  if (data.usage) {
    const u = byOffset(data.usage.months, db.months, 0);
    const up = byOffset(data.usage.months, db.months, 1);
    const rows = [
      ["Page views", ...compareCells(u?.pageviews ?? 0, up, "pageviews")],
      ["Unique visitors", ...compareCells(u?.visitors ?? 0, up, "visitors")],
      ["Sessions", ...compareCells(u?.sessions ?? 0, up, "sessions")],
      [
        "Browser errors",
        ...compareCells(u?.client_errors ?? 0, up, "client_errors"),
      ],
    ];
    usageHtml = table(
      ["", label.split(" ")[0], prev ? monthShort(prev.month) : "–", "Change"],
      rows,
      ["l", "r", "r", "r"],
    );
    if (data.usage.top_pages.length) {
      usageHtml +=
        `<p style="font-size:12px;color:${COLOR.muted};margin:8px 0 4px">Most viewed pages</p>` +
        table(
          ["Path", "Views"],
          data.usage.top_pages.map((p) => [
            escapeHtml(p.path),
            fmtInt(p.views),
          ]),
          ["l", "r"],
        );
    }
  } else {
    usageHtml = `<p style="color:${COLOR.muted}">Not configured — set <code>POSTHOG_PERSONAL_API_KEY</code> and <code>POSTHOG_PROJECT_ID</code> (docs/ops/observability.md).</p>`;
  }

  // --- Platform (Cloudflare) ------------------------------------------------
  let workersHtml: string;
  if (data.workers) {
    const w = byOffset(data.workers.months, db.months, 0);
    const wp = byOffset(data.workers.months, db.months, 1);
    const rows = [
      ["Worker requests", ...compareCells(w?.requests ?? 0, wp, "requests")],
      ["Worker errors", ...compareCells(w?.errors ?? 0, wp, "errors")],
      [
        "Error rate",
        escapeHtml(fmtPct(w?.errors ?? 0, w?.requests ?? 0)),
        escapeHtml(fmtPct(wp?.errors ?? 0, wp?.requests ?? 0)),
        "",
      ],
      [
        "CPU p50 / p99",
        `${escapeHtml(w?.cpu_p50_ms?.toFixed(1) ?? "–")} / ${escapeHtml(w?.cpu_p99_ms?.toFixed(1) ?? "–")} ms`,
        `${escapeHtml(wp?.cpu_p50_ms?.toFixed(1) ?? "–")} / ${escapeHtml(wp?.cpu_p99_ms?.toFixed(1) ?? "–")} ms`,
        "",
      ],
    ];
    workersHtml = table(
      ["", label.split(" ")[0], prev ? monthShort(prev.month) : "–", "Change"],
      rows,
      ["l", "r", "r", "r"],
    );
  } else {
    workersHtml = `<p style="color:${COLOR.muted}">Not configured — set <code>CLOUDFLARE_API_TOKEN</code> and <code>CLOUDFLARE_ACCOUNT_ID</code> (docs/ops/observability.md).</p>`;
  }

  // --- Health ---------------------------------------------------------------
  const healthRows = [
    ["Riders connected", fmtInt(db.riders.connected), "", ""],
    ["Synced in the last 7 days", fmtInt(db.riders.synced_last_7_days), "", ""],
    ["Need to reconnect Strava", fmtInt(db.riders.needs_reauth), "", ""],
    ["Never synced", fmtInt(db.riders.never_synced), "", ""],
    [
      "Sync jobs completed",
      ...compareCells(cur.sync_jobs_done, prev, "sync_jobs_done"),
    ],
    [
      "Sync jobs failed for good",
      ...compareCells(cur.sync_jobs_failed, prev, "sync_jobs_failed"),
    ],
    ["Server errors recorded", ...compareCells(cur.errors, prev, "errors")],
    [
      "Open / failed jobs right now",
      `${fmtInt(db.sync.open_jobs)} / ${fmtInt(db.sync.failed_jobs_open)}`,
      "",
      "",
    ],
  ];
  let healthHtml = table(
    ["", label.split(" ")[0], prev ? monthShort(prev.month) : "–", "Change"],
    healthRows,
    ["l", "r", "r", "r"],
  );
  if (db.errors.top.length) {
    healthHtml +=
      `<p style="font-size:12px;color:${COLOR.muted};margin:8px 0 4px">Most frequent server errors</p>` +
      table(
        ["Where", "Message", "Count"],
        db.errors.top.map((e) => [
          `<code>${escapeHtml(e.scope)}</code>`,
          escapeHtml(e.message.slice(0, 140)),
          fmtInt(e.count),
        ]),
        ["l", "l", "r"],
      );
  }
  if (db.sync.top_errors.length) {
    healthHtml +=
      `<p style="font-size:12px;color:${COLOR.muted};margin:8px 0 4px">Why sync jobs failed</p>` +
      table(
        ["Message", "Jobs"],
        db.sync.top_errors.map((e) => [escapeHtml(e.message), fmtInt(e.count)]),
        ["l", "r"],
      );
  }

  // --- Trend (three months) ---------------------------------------------------
  const trendRows = [cur, prev, prev2]
    .filter((m): m is MonthRow => !!m)
    .map((m) => [
      escapeHtml(monthLabel(m.month)),
      fmtInt(m.sf2g_rides),
      fmtInt(m.active_riders),
      fmtKmMi(m.sf2g_distance_meters),
      fmtInt(m.group_rides),
    ]);
  const trendHtml = table(
    ["Month", "SF2G rides", "Riders", "Distance", "Groups"],
    trendRows,
    ["l", "r", "r", "r", "r"],
  );

  const notesHtml = data.notes.length
    ? `<ul style="color:${COLOR.muted};font-size:12px;padding-left:18px">${data.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:${COLOR.bg};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${COLOR.text}">
<div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid ${COLOR.border};border-radius:12px;padding:24px">
  <div style="font-size:12px;color:${COLOR.accent};font-weight:700;letter-spacing:.08em;text-transform:uppercase">SF2G monthly report</div>
  <h1 style="font-size:24px;margin:4px 0 16px">${escapeHtml(label)}</h1>
  ${tiles}
  ${section("Corridors", routesHtml)}
  ${section("Riders of the month", topHtml)}
  ${section("Group rides", groupsHtml)}
  ${section("Three-month trend", trendHtml)}
  ${section("Site usage", usageHtml)}
  ${section("Platform", workersHtml)}
  ${section("Health", healthHtml)}
  <p style="margin-top:28px;font-size:12px;color:${COLOR.muted}">All time: ${fmtInt(db.all_time.sf2g_rides)} SF2G rides by ${fmtInt(db.all_time.riders_with_rides)} riders, ${fmtKmMi(db.all_time.sf2g_distance_meters)}. Generated ${escapeHtml(db.generated_at.slice(0, 16).replace("T", " "))} UTC · <a href="${escapeHtml(data.siteUrl)}" style="color:${COLOR.accent}">${escapeHtml(data.siteUrl.replace(/^https?:\/\//, ""))}</a></p>
  ${notesHtml}
</div>
</body></html>`;

  // --- Plain text -------------------------------------------------------------
  const t: string[] = [];
  const line = (k: string, v: string) => t.push(`${k.padEnd(30)} ${v}`);
  t.push(`SF2G monthly report — ${label}`, "");
  line(
    "SF2G rides",
    `${fmtInt(cur.sf2g_rides)} (${ridesDelta.label} vs ${prev ? monthShort(prev.month) : "–"})`,
  );
  line(
    "Active riders",
    `${fmtInt(cur.active_riders)} (${delta(cur.active_riders, prev?.active_riders).label})`,
  );
  line("New riders", `${fmtInt(cur.new_riders)}`);
  line("Distance", fmtKmMi(cur.sf2g_distance_meters));
  line("Climbing", fmtMFt(cur.sf2g_elevation_meters));
  line("Time in the saddle", fmtHours(cur.sf2g_moving_seconds));
  t.push("", "Corridors");
  for (const r of routeRows) {
    const key =
      Object.keys(ROUTE_LABELS).find((k) => ROUTE_LABELS[k] === r[0]) ?? "";
    line(
      `  ${ROUTE_LABELS[key] ?? key}`,
      `${fmtInt(cur.routes[key] ?? 0)} (${delta(cur.routes[key] ?? 0, prev?.routes[key] ?? 0).label})`,
    );
  }
  t.push("", "Riders of the month");
  for (const r of db.top_riders)
    line(
      `  ${r.display_name ?? "Anonymous"}`,
      `${fmtInt(r.rides)} rides, ${fmtKmMi(r.distance_meters)}`,
    );
  t.push("", "Group rides");
  line(
    "  Group rides",
    `${fmtInt(cur.group_rides)} (${delta(cur.group_rides, prev?.group_rides).label})`,
  );
  line("  Biggest group", fmtInt(cur.biggest_group));
  if (data.usage) {
    const u = byOffset(data.usage.months, db.months, 0);
    const up = byOffset(data.usage.months, db.months, 1);
    t.push("", "Site usage");
    line(
      "  Page views",
      `${fmtInt(u?.pageviews ?? 0)} (${delta(u?.pageviews ?? 0, up?.pageviews).label})`,
    );
    line(
      "  Unique visitors",
      `${fmtInt(u?.visitors ?? 0)} (${delta(u?.visitors ?? 0, up?.visitors).label})`,
    );
    line(
      "  Sessions",
      `${fmtInt(u?.sessions ?? 0)} (${delta(u?.sessions ?? 0, up?.sessions).label})`,
    );
    line("  Browser errors", `${fmtInt(u?.client_errors ?? 0)}`);
  }
  if (data.workers) {
    const w = byOffset(data.workers.months, db.months, 0);
    t.push("", "Platform");
    line("  Worker requests", fmtInt(w?.requests ?? 0));
    line(
      "  Worker errors",
      `${fmtInt(w?.errors ?? 0)} (${fmtPct(w?.errors ?? 0, w?.requests ?? 0)})`,
    );
    line(
      "  CPU p50 / p99",
      `${w?.cpu_p50_ms?.toFixed(1) ?? "–"} / ${w?.cpu_p99_ms?.toFixed(1) ?? "–"} ms`,
    );
  }
  t.push("", "Health");
  line("  Riders connected", fmtInt(db.riders.connected));
  line("  Synced last 7 days", fmtInt(db.riders.synced_last_7_days));
  line("  Need to reconnect", fmtInt(db.riders.needs_reauth));
  line(
    "  Sync jobs done / failed",
    `${fmtInt(cur.sync_jobs_done)} / ${fmtInt(cur.sync_jobs_failed)}`,
  );
  line(
    "  Server errors recorded",
    `${fmtInt(cur.errors)} (${delta(cur.errors, prev?.errors).label})`,
  );
  for (const e of db.errors.top)
    line(`    ${e.scope}`, `${e.count}× ${e.message.slice(0, 100)}`);
  t.push(
    "",
    `All time: ${fmtInt(db.all_time.sf2g_rides)} SF2G rides by ${fmtInt(db.all_time.riders_with_rides)} riders, ${fmtKmMi(db.all_time.sf2g_distance_meters)}.`,
  );
  for (const n of data.notes) t.push(`Note: ${n}`);
  t.push(data.siteUrl);

  return { subject, html, text: t.join("\n") };
}
