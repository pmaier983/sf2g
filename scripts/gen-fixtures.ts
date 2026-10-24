/**
 * Deterministic fixture dataset for local development and DB tests.
 *
 *   node scripts/gen-fixtures.ts
 *
 * Writes:
 *   supabase/seed/010_fixtures.sql   — users, rides, ride_overrides
 *   supabase/seed/EXPECTED.json      — totals computed here, independently of
 *                                      the SQL views, used to validate them
 *
 * Everything is derived from a seeded PRNG and fixed ids, so re-running the
 * script produces byte-identical output. Change SEED or the rider specs only
 * when you intend to regenerate every golden that depends on them.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import polyline from "@mapbox/polyline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 20261022;
const TZ = "America/Los_Angeles";
const STRAVA_TZ = "(GMT-08:00) America/Los_Angeles";

// ---------------------------------------------------------------------------
// PRNG (mulberry32)
// ---------------------------------------------------------------------------
let state = SEED;
function rand(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------
type LatLng = [number, number];
type Route =
  | "bayway"
  | "skyline"
  | "hmbw"
  | "royale"
  | "fleaway"
  | "mebw"
  | "febw"
  | "other";

const PEETS: LatLng = [37.773433, -122.438898]; // PPR @ Peets
const LATE_START: LatLng = [37.7599, -122.4148]; // Mission — not near any PPR intercept
const PALO_ALTO: LatLng = [37.4419, -122.143];
const MOUNTAIN_VIEW: LatLng = [37.422, -122.084];

/** Coarse route shapes (SF → Peninsula); densified below. */
const ROUTE_SHAPES: Record<Route, LatLng[]> = {
  bayway: [
    [37.773, -122.439],
    [37.755, -122.418],
    [37.728, -122.4],
    [37.69, -122.4],
    [37.66, -122.39],
    [37.63, -122.37],
    [37.58, -122.31],
    [37.54, -122.28],
    [37.5, -122.26],
    [37.45, -122.18],
  ],
  skyline: [
    [37.773, -122.439],
    [37.755, -122.45],
    [37.73, -122.47],
    [37.698411, -122.495033],
    [37.69, -122.485],
    [37.63, -122.47],
    [37.57, -122.44],
    [37.52, -122.35],
    [37.45, -122.28],
    [37.44, -122.17],
  ],
  hmbw: [
    [37.773, -122.439],
    [37.755, -122.5],
    [37.7, -122.505],
    [37.63, -122.49],
    [37.55, -122.51],
    [37.47, -122.43],
    [37.4, -122.35],
    [37.45, -122.18],
  ],
  royale: [
    [37.773, -122.439],
    [37.74, -122.42],
    [37.71, -122.405],
    [37.66, -122.405],
    [37.61, -122.4],
    [37.57, -122.34],
    [37.52, -122.28],
    [37.45, -122.18],
  ],
  fleaway: [
    [37.773, -122.439],
    [37.75, -122.41],
    [37.7, -122.405],
    [37.64, -122.41],
    [37.59, -122.36],
    [37.53, -122.29],
    [37.47, -122.2],
    [37.44, -122.16],
  ],
  mebw: [
    [37.773, -122.439],
    [37.79, -122.39],
    [37.8, -122.27],
    [37.7, -122.08],
    [37.55, -121.98],
    [37.45, -121.95],
    [37.42, -122.08],
  ],
  febw: [
    [37.773, -122.439],
    [37.8, -122.27],
    [37.88, -122.19],
    [37.75, -121.93],
    [37.7, -121.9],
    [37.5, -121.92],
    [37.42, -122.08],
  ],
  other: [
    [37.773, -122.439],
    [37.72, -122.44],
    [37.66, -122.43],
    [37.6, -122.38],
    [37.52, -122.3],
    [37.44, -122.16],
  ],
};

const ROUTE_STATS: Record<Route, { km: number; climbM: number }> = {
  bayway: { km: 48, climbM: 180 },
  skyline: { km: 56, climbM: 900 },
  hmbw: { km: 72, climbM: 1100 },
  royale: { km: 46, climbM: 300 },
  fleaway: { km: 47, climbM: 250 },
  mebw: { km: 68, climbM: 600 },
  febw: { km: 82, climbM: 1300 },
  other: { km: 42, climbM: 350 },
};

/** Linear interpolation so polyline overlap / intercept checks have points to hit. */
function densify(points: LatLng[], stepsPerSegment = 6): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    for (let s = 0; s < stepsPerSegment; s++) {
      const f = s / stepsPerSegment;
      out.push([
        round(a[0] + (b[0] - a[0]) * f, 5),
        round(a[1] + (b[1] - a[1]) * f, 5),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function routePath(
  route: Route,
  start: LatLng,
  end: LatLng,
  reverse: boolean,
): LatLng[] {
  const middle = ROUTE_SHAPES[route].slice(1, -1);
  const forward = densify([start, ...middle, end]);
  return reverse ? [...forward].reverse() : forward;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
/** UTC instant for a wall-clock time in America/Los_Angeles. */
function laToUtc(date: string, hh: number, mm: number): Date {
  // Start from the naive UTC guess, then correct by the zone offset at that instant.
  const guess = new Date(
    `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`,
  );
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocal = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
  );
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWeekend = (date: string) => dow(date) === 0 || dow(date) === 6;

// ---------------------------------------------------------------------------
// Riders
// ---------------------------------------------------------------------------
interface RiderSpec {
  n: number;
  first: string;
  last: string;
  /** Route weights for solo rides. */
  routes: Partial<Record<Route, number>>;
  rides: number;
  years: [number, number];
  speed: [number, number]; // m/s
  watts?: [number, number];
  hr?: [number, number];
  pprShare: number; // share of rides starting at Peets at 06:00
  weekendShare: number;
  reverseShare: number;
  nonCommuteShare: number; // route_category NULL (not an SF2G ride)
  company?:
    | "google"
    | "apple"
    | "meta"
    | "netflix"
    | "nvidia"
    | "stanford"
    | "tesla";
  scopes?: string;
  deauthorized?: boolean;
}

export const RIDERS: RiderSpec[] = [
  {
    n: 1,
    first: "Ada",
    last: "Bayway",
    routes: { bayway: 6, royale: 1, other: 1 },
    rides: 80,
    years: [2019, 2026],
    speed: [6.2, 7.4],
    watts: [170, 230],
    hr: [135, 150],
    pprShare: 0.3,
    weekendShare: 0.05,
    reverseShare: 0.05,
    nonCommuteShare: 0.1,
    company: "google",
  },
  {
    n: 2,
    first: "Ben",
    last: "Skyline",
    routes: { skyline: 8, hmbw: 1 },
    rides: 90,
    years: [2018, 2026],
    speed: [7.0, 8.4],
    watts: [200, 260],
    hr: [140, 158],
    pprShare: 0.6,
    weekendShare: 0.03,
    reverseShare: 0,
    nonCommuteShare: 0.05,
    company: "apple",
  },
  {
    n: 3,
    first: "Cam",
    last: "Mixed",
    routes: {
      bayway: 2,
      skyline: 2,
      hmbw: 1,
      royale: 2,
      fleaway: 2,
      mebw: 1,
      febw: 1,
      other: 2,
    },
    rides: 70,
    years: [2020, 2026],
    speed: [5.8, 7.2],
    pprShare: 0.15,
    weekendShare: 0.1,
    reverseShare: 0.1,
    nonCommuteShare: 0.15,
  },
  {
    n: 4,
    first: "Dee",
    last: "Reverse",
    routes: { royale: 3, bayway: 2 },
    rides: 40,
    years: [2022, 2026],
    speed: [6.0, 7.0],
    hr: [130, 145],
    pprShare: 0,
    weekendShare: 0.05,
    reverseShare: 0.5,
    nonCommuteShare: 0.05,
    company: "meta",
  },
  {
    n: 5,
    first: "Eve",
    last: "Weekend",
    routes: { hmbw: 3, skyline: 1 },
    rides: 30,
    years: [2023, 2026],
    speed: [6.5, 7.5],
    pprShare: 0.1,
    weekendShare: 0.7,
    reverseShare: 0,
    nonCommuteShare: 0.1,
  },
  {
    n: 6,
    first: "Fay",
    last: "Hidden",
    routes: { bayway: 2, skyline: 1 },
    rides: 25,
    years: [2024, 2026],
    speed: [6.0, 6.8],
    pprShare: 0.2,
    weekendShare: 0.05,
    reverseShare: 0,
    nonCommuteShare: 0.1,
    company: "netflix",
  },
  {
    n: 7,
    first: "Gus",
    last: "NoRides",
    routes: {},
    rides: 0,
    years: [2026, 2026],
    speed: [6, 6],
    pprShare: 0,
    weekendShare: 0,
    reverseShare: 0,
    nonCommuteShare: 0,
  },
  {
    n: 8,
    first: "Hal",
    last: "Deauthorized",
    routes: { bayway: 1, royale: 1 },
    rides: 15,
    years: [2021, 2024],
    speed: [6.0, 6.6],
    pprShare: 0,
    weekendShare: 0,
    reverseShare: 0,
    nonCommuteShare: 0,
    deauthorized: true,
  },
  {
    n: 9,
    first: "Ivy",
    last: "NoScope",
    routes: { skyline: 1 },
    rides: 10,
    years: [2025, 2026],
    speed: [6.8, 7.6],
    pprShare: 0.3,
    weekendShare: 0,
    reverseShare: 0,
    nonCommuteShare: 0,
    scopes: "",
  },
];

export const userId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Shared group-ride days: these riders ride the same route at the same time. */
const GROUP_DAYS: Array<{
  date: string;
  route: Route;
  riders: number[];
  hh: number;
  mm: number;
}> = [
  { date: "2026-10-13", route: "skyline", riders: [1, 2, 3], hh: 6, mm: 0 },
  { date: "2026-10-06", route: "skyline", riders: [2, 9], hh: 6, mm: 0 },
  { date: "2026-09-29", route: "bayway", riders: [1, 4, 6], hh: 6, mm: 5 },
  { date: "2026-08-18", route: "hmbw", riders: [2, 5], hh: 6, mm: 30 },
  { date: "2025-06-10", route: "skyline", riders: [1, 2], hh: 6, mm: 0 },
  { date: "2024-05-14", route: "royale", riders: [3, 4], hh: 7, mm: 10 },
];

// ---------------------------------------------------------------------------
// Ride generation
// ---------------------------------------------------------------------------
interface Ride {
  id: string;
  user: number;
  stravaId: number;
  name: string;
  date: string;
  start: Date;
  route: Route | null;
  reverse: boolean;
  ppr: boolean;
  distance: number;
  moving: number;
  elapsed: number;
  climb: number;
  speed: number;
  maxSpeed: number;
  startLatLng: LatLng;
  endLatLng: LatLng;
  polyline: string;
  watts: number | null;
  maxWatts: number | null;
  hr: number | null;
  maxHr: number | null;
  kj: number | null;
  tailwind: number | null;
  company: string | null;
  hidden: boolean;
}

let rideSeq = 0;
const rideUuid = () =>
  `10000000-0000-4000-8000-${String(++rideSeq).padStart(12, "0")}`;

function weightedRoute(weights: Partial<Record<Route, number>>): Route {
  const entries = Object.entries(weights) as Array<[Route, number]>;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rand() * total;
  for (const [r, w] of entries) {
    if ((x -= w) <= 0) return r;
  }
  return entries[entries.length - 1][0];
}

function randomDate(years: [number, number], weekend: boolean): string {
  for (;;) {
    const y = Math.floor(between(years[0], years[1] + 1));
    const max = y === 2026 ? 288 : 364; // fixtures end 2026-10-15
    const d = addDays(`${y}-01-01`, Math.floor(rand() * max));
    if (isWeekend(d) === weekend) return d;
  }
}

function makeRide(
  spec: RiderSpec,
  date: string,
  route: Route | null,
  opts: { ppr: boolean; reverse: boolean; hh?: number; mm?: number },
): Ride {
  const effectiveRoute: Route = route ?? "other";
  const { km, climbM } = ROUTE_STATS[effectiveRoute];
  const distance = round(km * 1000 * between(0.95, 1.08), 1);
  const speed = round(between(...spec.speed), 3);
  const moving = Math.round(distance / speed);
  const elapsed = Math.round(moving * between(1.05, 1.25));

  // PPR rides start at Peets at 06:00 ± 4 min; others start elsewhere/at other times.
  // Non-PPR rides start 07:00–09:59; 08:00+ falls outside the ppr_dawn_rides window.
  let hh = opts.hh ?? pick([7, 8, 8, 9]);
  let mm = opts.mm ?? Math.floor(between(0, 59));
  let start: LatLng = LATE_START;
  if (opts.ppr) {
    hh = 6;
    mm = opts.mm ?? Math.floor(between(0, 4));
    start = PEETS;
  } else if (opts.hh !== undefined) {
    start = PEETS;
  } else if (rand() < 0.3) {
    // Inside the ppr_dawn_rides window (04:00–07:59) but not within ±10 min of
    // 06:00 at Peets — exercises the timing check.
    hh = 5;
    start = PEETS;
  }
  const end = spec.company === "apple" ? MOUNTAIN_VIEW : PALO_ALTO;
  const path = routePath(effectiveRoute, start, end, opts.reverse);
  const startLatLng = path[0];
  const endLatLng = path[path.length - 1];

  const watts = spec.watts ? Math.round(between(...spec.watts)) : null;
  const hr = spec.hr ? Math.round(between(...spec.hr)) : null;
  return {
    id: rideUuid(),
    user: spec.n,
    stravaId: 9_000_000_000 + rideSeq,
    name: opts.reverse
      ? "G2SF"
      : route
        ? `SF2G ${effectiveRoute}`
        : "Afternoon Ride",
    date,
    start: laToUtc(date, hh, mm),
    route,
    reverse: opts.reverse,
    ppr: opts.ppr,
    distance,
    moving,
    elapsed,
    climb: round(climbM * between(0.9, 1.1), 1),
    speed,
    maxSpeed: round(speed * between(1.8, 2.4), 3),
    startLatLng,
    endLatLng,
    polyline: polyline.encode(path),
    watts,
    maxWatts: watts ? Math.round(watts * between(3, 4.5)) : null,
    hr,
    maxHr: hr ? hr + Math.round(between(15, 30)) : null,
    kj: watts ? Math.round((watts * moving) / 1000) : null,
    tailwind: rand() < 0.5 ? round(between(-3, 3), 2) : null,
    company:
      route && route !== "other" && !opts.reverse
        ? (spec.company ?? null)
        : null,
    hidden: false,
  };
}

const rides: Ride[] = [];
const takenDates = new Map<number, Set<string>>();
const claim = (user: number, date: string) => {
  const set = takenDates.get(user) ?? new Set<string>();
  takenDates.set(user, set);
  if (set.has(date)) return false;
  set.add(date);
  return true;
};

// Group days first so they are guaranteed.
for (const g of GROUP_DAYS) {
  for (const n of g.riders) {
    const spec = RIDERS.find((r) => r.n === n)!;
    claim(n, g.date);
    rides.push(
      makeRide(spec, g.date, g.route, {
        ppr: g.hh === 6 && g.mm <= 4,
        reverse: false,
        hh: g.hh,
        mm: g.mm,
      }),
    );
  }
}

for (const spec of RIDERS) {
  const existing = rides.filter((r) => r.user === spec.n).length;
  for (let i = existing; i < spec.rides; i++) {
    const weekend = rand() < spec.weekendShare;
    let date = randomDate(spec.years, weekend);
    while (!claim(spec.n, date)) date = randomDate(spec.years, weekend);
    const nonCommute = rand() < spec.nonCommuteShare;
    const route = nonCommute ? null : weightedRoute(spec.routes);
    const reverse = !nonCommute && rand() < spec.reverseShare;
    const ppr = !nonCommute && !reverse && rand() < spec.pprShare;
    rides.push(makeRide(spec, date, route, { ppr, reverse }));
  }
}

// Fay's overrides: one ride hidden, one moved to another route, one marked not-SF2G.
const fay = rides.filter((r) => r.user === 6 && r.route && r.route !== "other");
const overrides = [
  {
    ride: fay[0],
    is_hidden: true,
    override_route_category: null as Route | null,
    is_not_sf2g: false,
  },
  {
    ride: fay[1],
    is_hidden: false,
    override_route_category: "royale" as Route,
    is_not_sf2g: false,
  },
  {
    ride: fay[2],
    is_hidden: false,
    override_route_category: null as Route | null,
    is_not_sf2g: true,
  },
];
for (const o of overrides) {
  if (o.is_hidden) o.ride.hidden = true;
  if (o.override_route_category) o.ride.route = o.override_route_category;
  if (o.is_not_sf2g) o.ride.route = null;
}

rides.sort((a, b) => a.start.getTime() - b.start.getTime() || a.user - b.user);

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const q = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const latestByUser = new Map<number, Date>();
for (const r of rides) {
  const cur = latestByUser.get(r.user);
  if (!cur || r.start > cur) latestByUser.set(r.user, r.start);
}

const FIXTURE_NOW = "2026-10-16T12:00:00Z";

/** Inline SVG avatar: allowed by the site's CSP (data:) and needs no network. */
function avatarDataUri(initials: string, n: number): string {
  const hue = (n * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue},60%,45%)"/><text x="32" y="40" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
let sql = `-- GENERATED by scripts/gen-fixtures.ts — do not edit by hand.
-- ${RIDERS.length} riders, ${rides.length} rides, ${overrides.length} ride overrides.

BEGIN;

INSERT INTO users (id, strava_id, username, first_name, last_name, avatar_url,
  strava_access_token, strava_refresh_token, strava_token_expires_at, strava_scopes,
  last_sync_at, last_activity_at, created_at, updated_at, deauthorized_at) VALUES
`;
sql +=
  RIDERS.map((s) => {
    const latest = latestByUser.get(s.n);
    return `  (${[
      q(userId(s.n)),
      7_000_000 + s.n,
      q(s.first.toLowerCase()),
      q(s.first),
      q(s.last),
      q(avatarDataUri(s.first[0] + s.last[0], s.n)),
      q(`fixture-access-${s.n}`),
      q(`fixture-refresh-${s.n}`),
      q("2026-10-16T18:00:00Z"),
      q(s.scopes ?? "read,activity:read_all"),
      q(latest ? FIXTURE_NOW : null),
      q(latest?.toISOString() ?? null),
      q("2026-06-01T00:00:00Z"),
      q(FIXTURE_NOW),
      q(s.deauthorized ? "2026-09-01T00:00:00Z" : null),
    ].join(", ")})`;
  }).join(",\n") + ";\n\n";

const rideCols = `id, user_id, strava_activity_id, name, ride_date, start_date, timezone,
  route_category, classification_confidence, classification_method,
  distance_meters, moving_time_seconds, elapsed_time_seconds, elevation_gain_meters,
  average_speed_mps, max_speed_mps, start_latlng, end_latlng, summary_polyline,
  is_commute, is_private, destination_company, tailwind_component_ms,
  average_watts, max_watts, average_heartrate, max_heartrate, kilojoules,
  has_power_meter, has_heartrate, is_hidden, created_at`;

for (let i = 0; i < rides.length; i += 100) {
  sql += `INSERT INTO rides (${rideCols}) VALUES\n`;
  sql +=
    rides
      .slice(i, i + 100)
      .map(
        (r) =>
          `  (${[
            q(r.id),
            q(userId(r.user)),
            r.stravaId,
            q(r.name),
            q(r.date),
            q(r.start.toISOString()),
            q(STRAVA_TZ),
            q(r.route),
            r.route ? 0.9 : "NULL",
            r.route ? q("gateway") : "NULL",
            r.distance,
            r.moving,
            r.elapsed,
            r.climb,
            r.speed,
            r.maxSpeed,
            `'${JSON.stringify(r.startLatLng)}'::jsonb`,
            `'${JSON.stringify(r.endLatLng)}'::jsonb`,
            q(r.polyline),
            q(!!r.route),
            "FALSE",
            q(r.company),
            q(r.tailwind),
            q(r.watts),
            q(r.maxWatts),
            q(r.hr),
            q(r.maxHr),
            q(r.kj),
            q(r.watts !== null),
            q(r.hr !== null),
            q(r.hidden),
            q(new Date(r.start.getTime() + 6 * 3600_000).toISOString()),
          ].join(", ")})`,
      )
      .join(",\n") + ";\n\n";
}

sql += `INSERT INTO ride_overrides (ride_id, user_id, override_route_category, is_hidden, is_not_sf2g) VALUES\n`;
sql +=
  overrides
    .map(
      (o) =>
        `  (${[q(o.ride.id), q(userId(o.ride.user)), q(o.override_route_category), q(o.is_hidden), q(o.is_not_sf2g)].join(", ")})`,
    )
    .join(",\n") + ";\n\n";
sql += `COMMIT;\n`;

// ---------------------------------------------------------------------------
// Independently computed expectations
// ---------------------------------------------------------------------------
const SF2G = (r: Ride) => r.route !== null && r.route !== "other";
const expected = {
  generatedFrom: "scripts/gen-fixtures.ts",
  fixtureNow: FIXTURE_NOW,
  totals: {
    riders: RIDERS.length,
    rides: rides.length,
    sf2gRides: rides.filter(SF2G).length,
  },
  perRider: Object.fromEntries(
    RIDERS.map((s) => {
      const mine = rides.filter((r) => r.user === s.n);
      const sf2g = mine.filter(SF2G);
      const byRoute: Record<string, number> = {};
      for (const r of mine) {
        const key = r.route ?? "none";
        byRoute[key] = (byRoute[key] ?? 0) + 1;
      }
      return [
        userId(s.n),
        {
          name: `${s.first} ${s.last}`,
          totalRides: mine.length,
          sf2gTotal: sf2g.length,
          sf2gWeekdays: sf2g.filter((r) => !isWeekend(r.date)).length,
          /** SF2G rides the rider has not hidden — what every leaderboard should count. */
          sf2gVisible: sf2g.filter((r) => !r.hidden).length,
          sf2gVisibleWeekdays: sf2g.filter(
            (r) => !r.hidden && !isWeekend(r.date),
          ).length,
          /** SF2G + "other" (unclassified commute) rides, visible. */
          commutesVisible: mine.filter((r) => r.route !== null && !r.hidden)
            .length,
          sf2gReverse: sf2g.filter((r) => r.reverse).length,
          pprDawnRides: mine.filter((r) => r.ppr).length,
          hiddenRides: mine.filter((r) => r.hidden).length,
          byRoute,
          sf2gDistanceMeters: round(
            sf2g.reduce((s2, r) => s2 + r.distance, 0),
            1,
          ),
          activeYears: new Set(sf2g.map((r) => r.date.slice(0, 4))).size,
          lastRideDate:
            sf2g
              .map((r) => r.date)
              .sort()
              .pop() ?? null,
          firstRideDate: sf2g.map((r) => r.date).sort()[0] ?? null,
        },
      ];
    }),
  ),
  groupDays: GROUP_DAYS.map((g) => ({ ...g, riders: g.riders.map(userId) })),
};

mkdirSync(resolve(ROOT, "supabase/seed"), { recursive: true });
writeFileSync(resolve(ROOT, "supabase/seed/010_fixtures.sql"), sql);
writeFileSync(
  resolve(ROOT, "supabase/seed/EXPECTED.json"),
  JSON.stringify(expected, null, 2) + "\n",
);
console.log(`wrote ${rides.length} rides for ${RIDERS.length} riders`);
