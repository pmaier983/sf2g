/**
 * Corridor route geometry + elevation for the /segments route view
 * (rework phase 07c). Run once per corridor; the output is committed.
 *
 *   STRAVA_ACCESS_TOKEN=… node scripts/gen-corridor-profile.ts \
 *     --activity 20662409258 --start 37.71894,-122.50040 --end 37.39887,-122.13453
 *
 *   # or from streams saved earlier (Strava API or connector shape):
 *   node scripts/gen-corridor-profile.ts --activity 20662409258 \
 *     --streams /path/to/streams.json --start … --end …
 *
 *   # the 40-point test fixture, from the current SKYLINE_REFERENCE_POLYLINE:
 *   node scripts/gen-corridor-profile.ts --fixture
 *
 * Writes app/lib/corridors/skyline-profile.json (≤ 600 points) and prints the
 * simplified reference polyline (≤ 250 points) for SKYLINE_REFERENCE_POLYLINE
 * in app/lib/constants.ts. Cuts at the stream samples nearest to --start and
 * --end. Reads nothing else and writes nothing else; the token is only sent
 * to Strava.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import polyline from "@mapbox/polyline";
import { SKYLINE_REFERENCE_POLYLINE } from "../app/lib/constants.ts";

type LatLng = [number, number];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "app/lib/corridors/skyline-profile.json");
const FIXTURE_OUT = resolve(ROOT, "app/test/fixtures/corridor-profile.json");

const MAX_PROFILE_POINTS = 600;
const MAX_LINE_POINTS = 250;
const LINE_TOLERANCE_M = 15;

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
function latLngArg(name: string): LatLng {
  const raw = arg(name);
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 2 || parts.some((n) => !Number.isFinite(n)))
    throw new Error(`--${name} must be "lat,lng"`);
  return [parts[0], parts[1]];
}

function haversineM(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ---------------------------------------------------------------------------
// Douglas–Peucker over any 2-D projection of the points
// ---------------------------------------------------------------------------
function douglasPeucker(
  xy: Array<[number, number]>,
  tolerance: number,
): Set<number> {
  const keep = new Set<number>([0, xy.length - 1]);
  const stack: Array<[number, number]> = [[0, xy.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstD > tolerance) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return keep;
}

/** Metres east/north of the first point (equirectangular; fine at 60 km). */
function planar(latlng: LatLng[]): Array<[number, number]> {
  const [lat0, lng0] = latlng[0];
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return latlng.map(([lat, lng]) => [
    (lng - lng0) * mPerLng,
    (lat - lat0) * 111_320,
  ]);
}

/** Smallest tolerance (doubling from `start`) that keeps ≤ max points. */
function simplify(
  project: () => Array<[number, number]>,
  start: number,
  max: number,
): Set<number> {
  const xy = project();
  for (let tol = start; ; tol *= 1.25) {
    const keep = douglasPeucker(xy, tol);
    if (keep.size <= max) return keep;
  }
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------
interface Streams {
  latlng: LatLng[];
  distance: number[];
  altitude: number[];
}

function normalize(raw: Record<string, unknown>): Streams {
  // Strava API (key_by_type=true): { latlng: { data: [...] }, … }
  // Strava connector: { location: [...], distance: [...], altitude: [...] }
  const pick = (k: string): unknown[] => {
    const v = raw[k] as unknown;
    if (Array.isArray(v)) return v;
    if (
      v &&
      typeof v === "object" &&
      Array.isArray((v as { data?: unknown }).data)
    )
      return (v as { data: unknown[] }).data;
    return [];
  };
  const latlng = (
    pick("latlng").length ? pick("latlng") : pick("location")
  ) as LatLng[];
  const distance = pick("distance") as number[];
  const altitude = pick("altitude") as number[];
  if (
    latlng.length === 0 ||
    latlng.length !== distance.length ||
    latlng.length !== altitude.length
  )
    throw new Error(
      `streams must have equal-length latlng/distance/altitude (got ${latlng.length}/${distance.length}/${altitude.length})`,
    );
  return { latlng, distance, altitude };
}

async function loadStreams(activityId: number): Promise<Streams> {
  const file = arg("streams");
  if (file) return normalize(JSON.parse(readFileSync(file, "utf8")));
  const token = process.env.STRAVA_ACCESS_TOKEN;
  if (!token)
    throw new Error("set STRAVA_ACCESS_TOKEN or pass --streams <file>");
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=distance,altitude,latlng&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Strava API error (${res.status})`);
  return normalize((await res.json()) as Record<string, unknown>);
}

function nearest(latlng: LatLng[], p: LatLng, from = 0): number {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i < latlng.length; i++) {
    const d = haversineM(latlng[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  // One point per line keeps diffs readable.
  const v = value as Record<string, unknown>;
  const lines = Object.entries(v).map(([k, x]) =>
    Array.isArray(x)
      ? `  ${JSON.stringify(k)}: [\n${x.map((e) => `    ${JSON.stringify(e)}`).join(",\n")}\n  ]`
      : `  ${JSON.stringify(k)}: ${JSON.stringify(x)}`,
  );
  writeFileSync(path, `{\n${lines.join(",\n")}\n}\n`);
}

function writeFixture(): void {
  const line = polyline.decode(SKYLINE_REFERENCE_POLYLINE) as LatLng[];
  const n = 40;
  const latlng = Array.from(
    { length: n },
    (_, i) => line[Math.round((i * (line.length - 1)) / (n - 1))],
  );
  let total = 0;
  const distance = latlng.map((p, i) => {
    if (i > 0) total += haversineM(latlng[i - 1], p);
    return round(total, 1);
  });
  // Synthetic hills: two climbs, deterministic.
  const altitude = distance.map((d) =>
    round(150 + 120 * Math.sin(d / 6000) + 40 * Math.sin(d / 1500), 1),
  );
  writeJson(FIXTURE_OUT, {
    activityId: 0,
    fetchedAt: "2026-10-16T12:00:00Z",
    points: n,
    distance,
    altitude,
    latlng,
  });
  console.log(
    `wrote ${FIXTURE_OUT} (${n} points, ${round(total / 1000, 2)} km)`,
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--fixture")) return writeFixture();

  const activityId = Number(arg("activity"));
  if (!Number.isInteger(activityId))
    throw new Error("--activity <id> is required");
  const startAt = latLngArg("start");
  const endAt = latLngArg("end");

  const s = await loadStreams(activityId);
  const i0 = nearest(s.latlng, startAt);
  const i1 = nearest(s.latlng, endAt, i0 + 1);
  const latlng = s.latlng
    .slice(i0, i1 + 1)
    .map(([lat, lng]) => [round(lat, 5), round(lng, 5)] as LatLng);
  const distance = s.distance.slice(i0, i1 + 1).map((d) => d - s.distance[i0]);
  const altitude = s.altitude.slice(i0, i1 + 1);

  // Reference line: shape only.
  const lineKeep = simplify(
    () => planar(latlng),
    LINE_TOLERANCE_M,
    MAX_LINE_POINTS,
  );
  const line = latlng.filter((_, i) => lineKeep.has(i));

  // Profile: keep the shape (8 m) and the elevation curve (1.5 m vertical
  // at 1:40 horizontal), loosening both until ≤ MAX_PROFILE_POINTS.
  let shapeTol = 8;
  let keep: number[] = [];
  for (;;) {
    const shape = douglasPeucker(planar(latlng), shapeTol);
    const elev = douglasPeucker(
      distance.map((d, i) => [d, altitude[i] * 40] as [number, number]),
      shapeTol * 7.5,
    );
    keep = [...new Set([...shape, ...elev])].sort((a, b) => a - b);
    if (keep.length <= MAX_PROFILE_POINTS) break;
    shapeTol *= 1.25;
  }

  const profile = {
    activityId,
    fetchedAt: new Date().toISOString().slice(0, 10) + "T00:00:00Z",
    points: keep.length,
    distance: keep.map((i) => round(distance[i], 1)),
    altitude: keep.map((i) => round(altitude[i], 1)),
    latlng: keep.map((i) => latlng[i]),
  };
  writeJson(OUT, profile);

  let lineLen = 0;
  for (let i = 1; i < line.length; i++)
    lineLen += haversineM(line[i - 1], line[i]);
  let maxGap = 0;
  for (let i = 1; i < latlng.length; i++)
    maxGap = Math.max(maxGap, haversineM(latlng[i - 1], latlng[i]));

  console.log(`wrote ${OUT}`);
  console.log(
    `  samples ${i0}–${i1} of ${s.latlng.length}; profile ${profile.points} points; ` +
      `${round(distance.at(-1)! / 1000, 2)} km by stream, max sample gap ${round(maxGap, 0)} m; ` +
      `altitude ${Math.min(...altitude)}–${Math.max(...altitude)} m`,
  );
  console.log(
    `  start ${JSON.stringify(latlng[0])} (${round(haversineM(latlng[0], startAt), 0)} m from --start), ` +
      `end ${JSON.stringify(latlng.at(-1))} (${round(haversineM(latlng.at(-1)!, endAt), 0)} m from --end)`,
  );
  console.log(
    `\nSKYLINE_REFERENCE_POLYLINE: ${line.length} points, ${round(lineLen / 1000, 1)} km, ` +
      `first ${JSON.stringify(line[0])}, last ${JSON.stringify(line.at(-1))}`,
  );
  console.log(JSON.stringify(polyline.encode(line)));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
