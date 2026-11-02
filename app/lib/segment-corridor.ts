/**
 * Which Strava segments belong to a corridor board (rework phase 07).
 *
 * Pure geometry, no I/O: a segment is "on Skyline" when both its start and
 * end are within SEGMENT_CORRIDOR_RADIUS_M of the corridor's reference line.
 * Its direction and its place on the route view come from projecting its
 * endpoints onto that line.
 */
import {
  SEGMENT_CORRIDORS,
  SEGMENT_CORRIDOR_RADIUS_M,
  SEGMENT_TERRAIN,
  type SegmentCorridor,
} from "./constants";
import { decodePolyline } from "./polyline";
import { haversineDistance } from "./route-classifier";

export interface SegmentGeometry {
  start_latlng: [number, number];
  end_latlng: [number, number];
  average_grade: number;
}

const METERS_PER_DEGREE_LAT = 111_320;

// Decoded once at module load, with the metres at each vertex.
const CORRIDOR_LINES = (
  Object.entries(SEGMENT_CORRIDORS) as Array<
    [SegmentCorridor, { polyline: string }]
  >
).map(([corridor, { polyline }]) => {
  const line = decodePolyline(polyline);
  return { corridor, line, cumulative: cumulativeDistances(line) };
});

/** Metres along `line` at each vertex (haversine between consecutive vertices). */
export function cumulativeDistances(line: [number, number][]): number[] {
  const out = new Array<number>(line.length);
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0)
      total += haversineDistance(
        line[i - 1][0],
        line[i - 1][1],
        line[i][0],
        line[i][1],
      );
    out[i] = total;
  }
  return out;
}

/**
 * Nearest point on `line` to `point` (point-to-segment, not point-to-vertex):
 * how far away it is, and how far along the line it lies. `cumulative` gives
 * the metres at each vertex (e.g. a ride's distance stream); by default the
 * haversine length of the line is used.
 */
export function projectOntoPolyline(
  point: [number, number],
  line: [number, number][],
  cumulative?: number[],
): { distanceM: number; alongM: number } {
  if (line.length === 0) return { distanceM: Infinity, alongM: 0 };
  const [plat, plng] = point;
  // Local equirectangular frame around the point — accurate enough at 55 km.
  const mPerLng = METERS_PER_DEGREE_LAT * Math.cos((plat * Math.PI) / 180);
  const toXY = ([lat, lng]: [number, number]) => [
    (lng - plng) * mPerLng,
    (lat - plat) * METERS_PER_DEGREE_LAT,
  ];

  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  let nearest: [number, number] = line[0];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    const b = line[Math.min(i + 1, line.length - 1)];
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Projection of the point (the origin) onto a→b, clamped to the segment
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d2 = x * x + y * y;
    if (d2 < best) {
      best = d2;
      bestI = i;
      bestT = t;
      nearest = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }

  const cum = cumulative ?? cumulativeDistances(line);
  const next = Math.min(bestI + 1, line.length - 1);
  return {
    distanceM: haversineDistance(plat, plng, nearest[0], nearest[1]),
    alongM: cum[bestI] + bestT * (cum[next] - cum[bestI]),
  };
}

/** Metres from a point to the nearest point on the polyline (point-to-segment, not point-to-vertex). */
export function distanceToPolylineMeters(
  point: [number, number],
  line: [number, number][],
): number {
  return projectOntoPolyline(point, line).distanceM;
}

/** 'skyline' when both endpoints are within SEGMENT_CORRIDOR_RADIUS_M of that corridor's line, else null. Checks every corridor in SEGMENT_CORRIDORS. */
export function classifySegmentCorridor(
  seg: SegmentGeometry,
): SegmentCorridor | null {
  for (const { corridor, line } of CORRIDOR_LINES) {
    if (
      distanceToPolylineMeters(seg.start_latlng, line) <=
        SEGMENT_CORRIDOR_RADIUS_M &&
      distanceToPolylineMeters(seg.end_latlng, line) <=
        SEGMENT_CORRIDOR_RADIUS_M
    ) {
      return corridor;
    }
  }
  return null;
}

/**
 * South = the morning SF → Peninsula direction. On a corridor it means
 * "further along the reference line" (the Skyline route heads east and even
 * north-east after Woodside, so latitude alone gets the tail wrong); off a
 * corridor, ending further south.
 */
export function segmentDirection(
  seg: Pick<SegmentGeometry, "start_latlng" | "end_latlng">,
  corridor?: SegmentCorridor | null,
): "south" | "north" {
  const c = corridor && CORRIDOR_LINES.find((x) => x.corridor === corridor);
  if (c) {
    const from = projectOntoPolyline(seg.start_latlng, c.line, c.cumulative);
    const to = projectOntoPolyline(seg.end_latlng, c.line, c.cumulative);
    return to.alongM > from.alongM ? "south" : "north";
  }
  return seg.end_latlng[0] < seg.start_latlng[0] ? "south" : "north";
}

export function segmentTerrain(
  averageGrade: number,
): "climb" | "flat" | "descent" {
  if (averageGrade >= SEGMENT_TERRAIN.climbMinGrade) return "climb";
  if (averageGrade >= SEGMENT_TERRAIN.flatMinGrade) return "flat";
  return "descent";
}

/** "4:49" → 289, "1:02:11" → 3731, "59s"/""/null → null. */
export function parseXomTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, h, mm, ss] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}
