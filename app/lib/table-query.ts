/**
 * TableQuery — the one validated state object behind every /leaderboard view
 * (Riders, Rides, All-time, Groups), stored in the URL.
 *
 * - Every field has a default and `.catch()`es to it, so a hand-edited or
 *   stale URL never throws.
 * - `sort`/`dir` are shared by all views and validated against the current
 *   view's allow-list; switching views resets them. (Every view scrolls
 *   infinitely, so there is no page in the URL.)
 * - Date presets are stored by name and resolved in America/Los_Angeles (the
 *   ride's local time), so server render and every browser agree on what
 *   "This Week" means.
 * - `serializeSearch` drops defaults so URLs stay short.
 * - Legacy params (`rSort`, `rDir`, `gSort`, `gDir`, `gPage`, preset + dates)
 *   are mapped on parse so links shared before this change keep working.
 */
import { z } from "zod";
import {
  DESTINATION_COMPANY_VALUES,
  LEADERBOARD_SORT_COLUMNS,
  ROUTE_CATEGORY_VALUES,
} from "./leaderboard-query";

export const VIEWS = ["riders", "rides", "alltime", "groups"] as const;
export type TableView = (typeof VIEWS)[number];

/** Sortable columns per view (must match the server allow-lists). */
export const SORT_COLUMNS = {
  riders: LEADERBOARD_SORT_COLUMNS,
  rides: [
    "ride_date",
    "average_speed_mps",
    "distance_meters",
    "elevation_gain_meters",
    "moving_time_seconds",
    "name",
    "route_category",
    "display_name",
    "average_watts",
    "max_watts",
    "average_heartrate",
    "max_heartrate",
    "kilojoules",
  ],
  alltime: ["displayName", "maxRidesInWindow", "windowStart", "windowEnd"],
  groups: [
    "date",
    "riderCount",
    "avgSpeedMps",
    "avgWatts",
    "avgHeartrate",
    "maxWatts",
    "maxSpeedMps",
    "totalDistanceMeters",
    "totalElevationMeters",
  ],
} as const satisfies Record<TableView, readonly string[]>;

export const DEFAULT_SORT: Record<
  TableView,
  { sort: string; dir: "asc" | "desc" }
> = {
  riders: { sort: "sf2g_total", dir: "desc" },
  rides: { sort: "ride_date", dir: "desc" },
  alltime: { sort: "maxRidesInWindow", dir: "desc" },
  groups: { sort: "date", dir: "desc" },
};

export const DATE_PRESETS = [
  "today",
  "this-week",
  "last-30-days",
  "this-month",
  "last-6-months",
  "last-365-days",
  "this-year",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

const bool = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true")
  .catch(false);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

const routes = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")))
  .transform((rs) => [
    ...new Set(
      rs.filter((r): r is (typeof ROUTE_CATEGORY_VALUES)[number] =>
        (ROUTE_CATEGORY_VALUES as readonly string[]).includes(r),
      ),
    ),
  ])
  .catch([]);

const BaseSchema = z.object({
  view: z.enum(VIEWS).catch("riders"),
  routes: routes.default([]),
  search: z.string().max(100).catch(""),
  ppr: bool.default(false),
  other: bool.default(false),
  weekends: bool.default(false),
  reverse: bool.default(false),
  company: z.enum(DESTINATION_COMPANY_VALUES).optional().catch(undefined),
  user: z.string().uuid().optional().catch(undefined),
  datePreset: z.enum(DATE_PRESETS).optional().catch(undefined),
  dateFrom: isoDate,
  dateTo: isoDate,
  duration: z
    .string()
    .regex(/^\d{1,3}[dwmy]$/i)
    .catch("1w"),
  chart: bool.default(false),
  density: z.enum(["condensed", "expanded"]).catch("expanded"),
  sort: z.string().optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
});

export interface TableQuery {
  view: TableView;
  routes: (typeof ROUTE_CATEGORY_VALUES)[number][];
  search: string;
  ppr: boolean;
  other: boolean;
  weekends: boolean;
  reverse: boolean;
  company: (typeof DESTINATION_COMPANY_VALUES)[number] | undefined;
  user: string | undefined;
  /** A named range; when set, dateFrom/dateTo are not stored. */
  datePreset: DatePreset | undefined;
  /** Custom range (only when no preset). */
  dateFrom: string | undefined;
  dateTo: string | undefined;
  /** All-time rolling window. */
  duration: string;
  chart: boolean;
  density: "condensed" | "expanded";
  sort: string;
  dir: "asc" | "desc";
}

export const DEFAULT_TABLE_QUERY: TableQuery = {
  view: "riders",
  routes: [],
  search: "",
  ppr: false,
  other: false,
  weekends: false,
  reverse: false,
  company: undefined,
  user: undefined,
  datePreset: undefined,
  dateFrom: undefined,
  dateTo: undefined,
  duration: "1w",
  chart: false,
  density: "expanded",
  sort: DEFAULT_SORT.riders.sort,
  dir: DEFAULT_SORT.riders.dir,
};

/** Map pre-TableQuery params onto the current names (one-release compat). */
function applyLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const view = raw.view;
  const legacySort =
    view === "rides"
      ? [raw.rSort, raw.rDir]
      : view === "groups"
        ? [raw.gSort, raw.gDir]
        : [undefined, undefined];
  if (legacySort[0] !== undefined && out.sort === undefined)
    out.sort = legacySort[0];
  if (legacySort[1] !== undefined && out.dir === undefined)
    out.dir = legacySort[1];
  for (const k of ["rSort", "rDir", "gSort", "gDir", "gPage", "page"])
    delete out[k];
  return out;
}

/** Parse URL search params (or anything else) into a full TableQuery. */
export function parseSearch(raw: Record<string, unknown> = {}): TableQuery {
  const p = BaseSchema.parse(applyLegacy(raw ?? {}));
  const allowed = SORT_COLUMNS[p.view] as readonly string[];
  const sortValid = p.sort !== undefined && allowed.includes(p.sort);
  const def = DEFAULT_SORT[p.view];
  return {
    view: p.view,
    routes: p.routes,
    search: p.search,
    ppr: p.ppr,
    other: p.other,
    weekends: p.weekends,
    reverse: p.reverse,
    company: p.company,
    user: p.user,
    datePreset: p.datePreset,
    // A preset wins over stored dates (old URLs carried both).
    dateFrom: p.datePreset ? undefined : p.dateFrom,
    dateTo: p.datePreset ? undefined : p.dateTo,
    duration: p.duration,
    chart: p.chart,
    density: p.density,
    sort: sortValid ? p.sort! : def.sort,
    dir: sortValid ? (p.dir ?? def.dir) : def.dir,
  };
}

export type SearchValue = string | number | boolean;

/**
 * The URL form of a TableQuery: defaults omitted, routes comma-joined.
 * Booleans and numbers stay native: the router's stringifier would quote a
 * string like "true" to keep its type.
 */
export function serializeSearch(q: TableQuery): Record<string, SearchValue> {
  const out: Record<string, SearchValue> = {};
  const def = DEFAULT_SORT[q.view];
  const put = (k: string, v: SearchValue | undefined, d: unknown) => {
    if (v === undefined || v === d) return;
    out[k] = v;
  };
  put("view", q.view, "riders");
  if (q.routes.length > 0) out.routes = q.routes.join(",");
  put("search", q.search, "");
  put("ppr", q.ppr, false);
  put("other", q.other, false);
  put("weekends", q.weekends, false);
  put("reverse", q.reverse, false);
  put("company", q.company, undefined);
  put("user", q.user, undefined);
  put("datePreset", q.datePreset, undefined);
  if (!q.datePreset) {
    put("dateFrom", q.dateFrom, undefined);
    put("dateTo", q.dateTo, undefined);
  }
  put("duration", q.duration, "1w");
  put("chart", q.chart, false);
  put("density", q.density, "expanded");
  if (q.sort !== def.sort || q.dir !== def.dir) {
    out.sort = q.sort;
    out.dir = q.dir;
  }
  return out;
}

/**
 * Apply a patch the way every table control should: switching view resets
 * sort to that view's default (sort keys are per view), and a preset and a
 * custom date range replace each other.
 */
export function patchQuery(
  q: TableQuery,
  patch: Partial<TableQuery>,
): TableQuery {
  const next = { ...q, ...patch };
  if (patch.view && patch.view !== q.view && patch.sort === undefined) {
    next.sort = DEFAULT_SORT[patch.view].sort;
    next.dir = DEFAULT_SORT[patch.view].dir;
  }
  if (patch.datePreset) {
    next.dateFrom = undefined;
    next.dateTo = undefined;
  } else if (patch.dateFrom !== undefined || patch.dateTo !== undefined) {
    next.datePreset = undefined;
  }
  return next;
}

/** True when anything differs from the defaults (enables "Clear Filters"). */
export function hasActiveFilters(q: TableQuery): boolean {
  return Object.keys(serializeSearch(q)).length > 0;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const SF2G_TIME_ZONE = "America/Los_Angeles";

/** YYYY-MM-DD of `now` in `timeZone`. */
export function localDate(now: Date, timeZone = SF2G_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Inclusive date range for a preset, as calendar dates in `timeZone`. */
export function resolveDateRange(
  preset: DatePreset,
  now: Date = new Date(),
  timeZone = SF2G_TIME_ZONE,
): { from: string; to: string } {
  const today = localDate(now, timeZone);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this-week": {
      // Monday-based week
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "last-30-days":
      return { from: addDays(today, -30), to: today };
    case "this-month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last-6-months":
      return { from: addMonths(today, -6), to: today };
    case "last-365-days":
      return { from: addDays(today, -365), to: today };
    case "this-year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** The date range every query should use: the preset's, or the custom one. */
export function effectiveDateRange(
  q: Pick<TableQuery, "datePreset" | "dateFrom" | "dateTo">,
  now: Date = new Date(),
): { dateFrom: string | undefined; dateTo: string | undefined } {
  if (q.datePreset) {
    const r = resolveDateRange(q.datePreset, now);
    return { dateFrom: r.from, dateTo: r.to };
  }
  return { dateFrom: q.dateFrom, dateTo: q.dateTo };
}

/** Search object for a link to /leaderboard: defaults plus `patch`. */
export function leaderboardSearch(patch: Partial<TableQuery> = {}): TableQuery {
  return patchQuery(DEFAULT_TABLE_QUERY, patch);
}
