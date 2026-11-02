/**
 * Pure logic for the /races page: types for `public/data/races-2027.json`,
 * filtering/sorting, counts, and the geometry for the course map and
 * elevation profile SVGs.
 *
 * Nothing here runs in the Worker: the JSON is a static asset fetched by the
 * browser and every function below is called from the client only.
 */

import { courseTerrain, type Terrain, type TerrainKind } from "./race-terrain";

export const RACES_DATA_URL = "/data/races-2027.json";

export type RaceSection = "norcal" | "socal" | "stage";
export type RaceType =
  | "Road race"
  | "Circuit"
  | "Crit"
  | "Time trial"
  | "Stage race";
export type DateStatus =
  | "posted"
  | "tentative"
  | "confirmed"
  | "month"
  | "listed"
  | "tba";

export interface RaceSource {
  what: string;
  label: string;
  url: string | null;
}

export interface RaceCourse {
  lapMi: number;
  lapGainFt: number;
  minFt: number;
  maxFt: number;
  /** ~121 evenly spaced elevation samples for one lap */
  profileFt: number[];
  /** One lap, [x, y] = [lng·cos(lat0), lat]; already projected */
  path: [number, number][];
  pathSource: { label: string; url: string | null };
  elevationSource: { label: string; url: string };
}

export interface RaceEvent {
  id: string;
  name: string;
  section: RaceSection;
  type: RaceType;
  start: string | null;
  end: string | null;
  dates?: string[];
  dateStatus: DateStatus;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  drive: { mi: number; min: number } | null;
  notes: string | null;
  course: RaceCourse | null;
  format?: string;
  stages?: string[];
  previousEdition?: { start: string; end: string } | null;
  california?: boolean;
  sources: RaceSource[];
}

export interface RacesFile {
  title: string;
  generatedOn: string;
  origin: { label: string; lat: number; lng: number };
  methodology: { topic: string; text: string; url: string }[];
  events: RaceEvent[];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const SECTION_LABELS: Record<RaceSection, string> = {
  norcal: "NorCal",
  socal: "SoCal",
  stage: "Stage races",
};

/** Badge text per date status; null means no badge. */
export const STATUS_BADGES: Record<DateStatus, string | null> = {
  posted: null,
  confirmed: null,
  tentative: "Tentative",
  month: "Month only",
  listed: "Unconfirmed",
  tba: "2027 date TBA",
};

/** Drives longer than this are flagged "likely a flight". */
export const FLIGHT_THRESHOLD_MI = 600;

// ---------------------------------------------------------------------------
// URL search state
// ---------------------------------------------------------------------------

export type SectionFilter = "all" | RaceSection;
export type TypeFilter =
  | "all"
  | "Road race"
  | "Circuit"
  | "Crit"
  | "Time trial";
export type RaceSort =
  | "date"
  | "drive"
  | "time"
  | "hilliest"
  | "flattest"
  | "climb"
  | "name";
export type TerrainFilter = "all" | TerrainKind;

export interface RacesSearch {
  section: SectionFilter;
  type: TypeFilter;
  sort: RaceSort;
  terrain: TerrainFilter;
}

export const SECTION_FILTERS: SectionFilter[] = [
  "all",
  "norcal",
  "socal",
  "stage",
];
export const TYPE_FILTERS: TypeFilter[] = [
  "all",
  "Road race",
  "Circuit",
  "Crit",
  "Time trial",
];
export const TERRAIN_FILTERS: TerrainFilter[] = [
  "all",
  "flat",
  "hilly",
  "climb",
];

/** Sort chips, in display order. Each has one natural direction. */
export const RACE_SORTS: { value: RaceSort; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "drive", label: "Nearest" },
  { value: "time", label: "Quickest trip" },
  { value: "hilliest", label: "Hilliest" },
  { value: "flattest", label: "Flattest" },
  { value: "climb", label: "Biggest climb" },
  { value: "name", label: "A–Z" },
];
const SORTS = RACE_SORTS.map((s) => s.value);

export const RACES_SEARCH_DEFAULTS: RacesSearch = {
  section: "all",
  type: "all",
  sort: "date",
  terrain: "all",
};

function pick<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Validate `?section=&type=&sort=&terrain=`; unknown values fall back to defaults. */
export function parseRacesSearch(raw: Record<string, unknown>): RacesSearch {
  return {
    section: pick(raw.section, SECTION_FILTERS, RACES_SEARCH_DEFAULTS.section),
    type: pick(raw.type, TYPE_FILTERS, RACES_SEARCH_DEFAULTS.type),
    sort: pick(raw.sort, SORTS, RACES_SEARCH_DEFAULTS.sort),
    terrain: pick(raw.terrain, TERRAIN_FILTERS, RACES_SEARCH_DEFAULTS.terrain),
  };
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export interface RaceSummary {
  californiaEvents: number;
  californiaRoadRaces: number;
  stageRacesDated: number;
  coursesMapped: number;
}

export function summarizeRaces(events: RaceEvent[]): RaceSummary {
  const ca = events.filter((e) => e.section !== "stage");
  return {
    californiaEvents: ca.length,
    californiaRoadRaces: ca.filter((e) => e.type === "Road race").length,
    stageRacesDated: events.filter((e) => e.section === "stage" && e.start)
      .length,
    coursesMapped: ca.filter((e) => e.course).length,
  };
}

export function sectionCounts(
  events: RaceEvent[],
): Record<SectionFilter, number> {
  return {
    all: events.length,
    norcal: events.filter((e) => e.section === "norcal").length,
    socal: events.filter((e) => e.section === "socal").length,
    stage: events.filter((e) => e.section === "stage").length,
  };
}

// ---------------------------------------------------------------------------
// Filter + sort
// ---------------------------------------------------------------------------

export interface RaceLists {
  /** Events with a 2027 start date, in the requested order. */
  dated: RaceEvent[];
  /** Events with no 2027 date yet (stage races), nearest drive first. */
  tba: RaceEvent[];
}

export interface RaceSortInputs {
  /** Road miles from the chosen origin; defaults to the SF OSRM drive. */
  distanceOf?: (e: RaceEvent) => number | null | undefined;
  /** Travel minutes from the chosen origin; defaults to the SF OSRM drive. */
  minutesOf?: (e: RaceEvent) => number | null | undefined;
}

/** Terrain per course, computed once per course object. */
const terrainCache = new WeakMap<RaceCourse, Terrain>();
export function terrainOf(e: RaceEvent): Terrain | null {
  if (!e.course) return null;
  let t = terrainCache.get(e.course);
  if (!t) {
    t = courseTerrain(e.course);
    terrainCache.set(e.course, t);
  }
  return t;
}

export function terrainCounts(
  events: RaceEvent[],
): Record<TerrainFilter, number> {
  const c: Record<TerrainFilter, number> = {
    all: events.length,
    flat: 0,
    hilly: 0,
    climb: 0,
  };
  for (const e of events) {
    const t = terrainOf(e);
    if (t) c[t.kind]++;
  }
  return c;
}

type Key = number | null | undefined;

/** Ascending by key, missing keys last, ties by date. */
function byKey(key: (e: RaceEvent) => Key) {
  return (a: RaceEvent, b: RaceEvent) => {
    const ka = key(a);
    const kb = key(b);
    const ma = ka === null || ka === undefined;
    const mb = kb === null || kb === undefined;
    if (ma !== mb) return ma ? 1 : -1;
    if (!ma && !mb && ka !== kb) return (ka as number) - (kb as number);
    return (a.start ?? "9999").localeCompare(b.start ?? "9999");
  };
}

export function filterAndSortRaces(
  events: RaceEvent[],
  search: RacesSearch,
  inputs: RaceSortInputs = {},
): RaceLists {
  const distanceOf = inputs.distanceOf ?? ((e: RaceEvent) => e.drive?.mi);
  const minutesOf = inputs.minutesOf ?? ((e: RaceEvent) => e.drive?.min);
  const matching = events.filter(
    (e) =>
      (search.section === "all" || e.section === search.section) &&
      (search.type === "all" || e.type === search.type) &&
      (search.terrain === "all" || terrainOf(e)?.kind === search.terrain),
  );
  const dated = matching.filter((e) => e.start !== null);
  const tba = matching.filter((e) => e.start === null);

  const compare: Record<RaceSort, (a: RaceEvent, b: RaceEvent) => number> = {
    date: (a, b) => (a.start as string).localeCompare(b.start as string),
    drive: byKey(distanceOf),
    time: byKey(minutesOf),
    hilliest: byKey((e) => {
      const t = terrainOf(e);
      return t ? -t.ftPerMi : null;
    }),
    flattest: byKey((e) => terrainOf(e)?.ftPerMi),
    climb: byKey((e) => {
      const t = terrainOf(e);
      return t ? -t.biggestClimbFt : null;
    }),
    name: (a, b) => a.name.localeCompare(b.name, "en"),
  };
  dated.sort(compare[search.sort]);
  // Undated stage races: same order where it applies, else nearest first.
  tba.sort(search.sort === "date" ? byKey(distanceOf) : compare[search.sort]);
  return { dated, tba };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Parse an ISO date as local noon so the calendar day never shifts. */
export function raceDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function monthShort(iso: string): string {
  return raceDate(iso).toLocaleString("en-US", { month: "short" });
}

export function monthDay(iso: string): string {
  return raceDate(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function weekdayShortOf(iso: string): string {
  return raceDate(iso).toLocaleString("en-US", { weekday: "short" });
}

/** 111 minutes → "1 h 51" */
export function formatDriveMinutes(min: number): string {
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** "2026-06-05".."2026-06-07" → "Jun 5–7"; across months "Jun 30 – Jul 1"; same day "Jun 5" */
export function formatDateRange(start: string, end: string): string {
  if (start === end) return monthDay(start);
  const a = raceDate(start);
  const b = raceDate(end);
  if (a.getMonth() === b.getMonth()) {
    return `${monthDay(start)}–${b.getDate()}`;
  }
  return `${monthDay(start)} – ${monthDay(end)}`;
}

/** Matches the navbar MI/KM switcher (app/components/UnitToggle.tsx). */
export type DistanceUnit = "mi" | "km";

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Road/drive distance, whole units: 89 mi → { "143", "km" }. */
export function formatDistance(
  mi: number,
  unit: DistanceUnit,
): { value: string; unit: DistanceUnit } {
  return {
    value: fmtInt(unit === "km" ? mi * KM_PER_MI : mi),
    unit,
  };
}

/** "One lap · 22.14 mi · +1,990 ft · 242–1,552 ft" (metric: km and m). */
export function courseCaption(
  c: RaceCourse,
  unit: DistanceUnit = "mi",
): string {
  if (unit === "km") {
    const km = c.lapMi * KM_PER_MI;
    const lap = km.toFixed(km < 5 ? 2 : 1);
    const m = (ft: number) => fmtInt(ft * M_PER_FT);
    return `One lap · ${lap} km · +${m(c.lapGainFt)} m · ${m(c.minFt)}–${m(c.maxFt)} m`;
  }
  return `One lap · ${c.lapMi} mi · +${fmtInt(c.lapGainFt)} ft · ${fmtInt(c.minFt)}–${fmtInt(c.maxFt)} ft`;
}

export function isLikelyFlight(drive: { mi: number } | null): boolean {
  return drive !== null && drive.mi > FLIGHT_THRESHOLD_MI;
}

/** Every "What: link" entry for an event's sources line. */
export function sourceEntries(
  e: RaceEvent,
  /** Set when travel is estimated from somewhere other than SF City Hall. */
  estimatedFrom?: string,
): RaceSource[] {
  const out: RaceSource[] = [...e.sources];
  if (e.course) {
    out.push({ what: "Route", ...e.course.pathSource });
    out.push({ what: "Elevation", ...e.course.elevationSource });
  }
  if (estimatedFrom && e.lat !== null) {
    out.push({
      what: "Travel",
      label: `Estimated from ${estimatedFrom}`,
      url: null,
    });
  } else if (e.drive) {
    out.push({ what: "Drive", label: "OSRM from SF City Hall", url: null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SVG geometry
// ---------------------------------------------------------------------------

export interface MapGeometry {
  /** SVG path `d` for one lap, scaled to fit `size`×`size`. */
  d: string;
  /** Start point, for the dot. */
  start: { x: number; y: number };
  size: number;
}

const f1 = (n: number) => n.toFixed(1);

/** Fit the already-projected lap path into a square, preserving aspect ratio. */
export function mapGeometry(
  path: [number, number][],
  size = 64,
  pad = 5,
): MapGeometry {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of path) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const inner = size - 2 * pad;
  const scale = inner / Math.max(x1 - x0, y1 - y0, 1e-9);
  const ox = pad + (inner - (x1 - x0) * scale) / 2;
  const oy = pad + (inner - (y1 - y0) * scale) / 2;
  const pts = path.map(([x, y]) => ({
    x: ox + (x - x0) * scale,
    // y grows north in the data, south on screen
    y: size - (oy + (y - y0) * scale),
  }));
  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${f1(p.x)} ${f1(p.y)}`)
    .join(" ");
  return { d, start: pts[0] ?? { x: size / 2, y: size / 2 }, size };
}

/**
 * Vertical span for the profile: the real range, but never less than 60 ft
 * for laps under 3 mi or 300 ft otherwise, so flat crits look flat.
 */
export function profileSpanFt(
  c: Pick<RaceCourse, "minFt" | "maxFt" | "lapMi">,
): number {
  return Math.max(c.maxFt - c.minFt, c.lapMi < 3 ? 60 : 300);
}

export interface ProfileGeometry {
  /** SVG path `d` for the elevation line. */
  line: string;
  /** Same line closed to the baseline, for the fill. */
  area: string;
  width: number;
  height: number;
  spanFt: number;
}

export function profileGeometry(
  c: RaceCourse,
  width = 560,
  height = 64,
  pad = 4,
): ProfileGeometry {
  const span = profileSpanFt(c);
  const n = c.profileFt.length;
  const pts = c.profileFt.map((ft, i) => ({
    x: n > 1 ? (i * width) / (n - 1) : 0,
    y: height - pad - ((ft - c.minFt) / span) * (height - 2 * pad),
  }));
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${f1(p.x)} ${f1(p.y)}`)
    .join(" ");
  return {
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
    width,
    height,
    spanFt: span,
  };
}
