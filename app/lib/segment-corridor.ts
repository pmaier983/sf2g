/**
 * Which Strava segments belong to a corridor board (rework phase 07).
 *
 * Pure geometry, no I/O: a segment is "on Skyline" when both its start and
 * end are within SEGMENT_CORRIDOR_RADIUS_M of the corridor's reference line.
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

// Decoded once at module load.
const CORRIDOR_LINES = (
  Object.entries(SEGMENT_CORRIDORS) as Array<
    [SegmentCorridor, { polyline: string }]
  >
).map(([corridor, { polyline }]) => ({
  corridor,
  line: decodePolyline(polyline),
}));

/** Metres from a point to the nearest point on the polyline (point-to-segment, not point-to-vertex). */
export function distanceToPolylineMeters(
  point: [number, number],
  line: [number, number][],
): number {
  if (line.length === 0) return Infinity;
  const [plat, plng] = point;
  // Local equirectangular frame around the point — accurate enough at 26 km.
  const mPerLng = METERS_PER_DEGREE_LAT * Math.cos((plat * Math.PI) / 180);
  const toXY = ([lat, lng]: [number, number]) => [
    (lng - plng) * mPerLng,
    (lat - plat) * METERS_PER_DEGREE_LAT,
  ];

  let best = Infinity;
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
      nearest = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return haversineDistance(plat, plng, nearest[0], nearest[1]);
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

/** South = the morning SF → Peninsula direction. */
export function segmentDirection(seg: SegmentGeometry): "south" | "north" {
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
