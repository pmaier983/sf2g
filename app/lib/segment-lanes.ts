/**
 * Where each segment sits under the elevation profile (phase 07c).
 *
 * A segment's endpoints are projected onto the corridor route; its bar spans
 * the two along-track distances. Overlapping bars are packed into lanes the
 * way Strava's activity page does it: greedy by start, first free lane.
 */
import type { CorridorProfile } from "./corridor-profile";
import { projectOntoPolyline } from "./segment-corridor";

export interface Bar {
  id: number;
  startM: number;
  endM: number;
}

export interface PlacedBar extends Bar {
  lane: number;
}

/** Pack bars into lanes; a bar may start exactly where another ends. */
export function packLanes(bars: readonly Bar[]): PlacedBar[] {
  const sorted = [...bars].sort(
    (a, b) => a.startM - b.startM || a.endM - b.endM || a.id - b.id,
  );
  const laneEnds: number[] = [];
  return sorted.map((bar) => {
    let lane = laneEnds.findIndex((end) => end <= bar.startM);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.endM;
    return { ...bar, lane };
  });
}

export interface SegmentEndpoints {
  id: number;
  start_latlng: [number, number];
  end_latlng: [number, number];
}

/** Project each segment onto the route and pack the bars into lanes. */
export function placeSegments(
  segments: readonly SegmentEndpoints[],
  profile: Pick<CorridorProfile, "latlng" | "distance">,
): PlacedBar[] {
  const along = (p: [number, number]) =>
    projectOntoPolyline(p, profile.latlng, profile.distance).alongM;
  return packLanes(
    segments.map((s) => {
      const a = along(s.start_latlng);
      const b = along(s.end_latlng);
      return { id: s.id, startM: Math.min(a, b), endM: Math.max(a, b) };
    }),
  );
}

/** Number of lanes used by `bars` (0 when there are none). */
export function laneCount(bars: readonly PlacedBar[]): number {
  return bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
}
