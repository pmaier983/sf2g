/**
 * Route geometry and elevation for a corridor's route view (phase 07c).
 *
 * One real ride's Strava streams, cut to the corridor and downsampled by
 * scripts/gen-corridor-profile.ts, committed as static JSON. Loaded lazily in
 * the browser, so the data never touches a request handler or Strava.
 */
import type { SegmentCorridor } from "./constants";

export interface CorridorProfile {
  /** Strava activity the streams came from (provenance). */
  activityId: number;
  fetchedAt: string;
  /** === distance.length === altitude.length === latlng.length */
  points: number;
  /** Metres from the start of the corridor, strictly increasing. */
  distance: number[];
  /** Metres above sea level. */
  altitude: number[];
  latlng: [number, number][];
}

const LOADERS: Record<SegmentCorridor, () => Promise<{ default: unknown }>> = {
  skyline: () => import("./corridors/skyline-profile.json"),
};

export async function loadCorridorProfile(
  corridor: SegmentCorridor,
): Promise<CorridorProfile> {
  return (await LOADERS[corridor]()).default as CorridorProfile;
}

/** Index of the last profile point at or before `m` metres (binary search). */
export function indexAtDistance(profile: CorridorProfile, m: number): number {
  const d = profile.distance;
  let lo = 0;
  let hi = d.length - 1;
  if (m <= d[0]) return 0;
  if (m >= d[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= m) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point on the route `m` metres from its start (linear between samples). */
export function pointAtDistance(
  profile: CorridorProfile,
  m: number,
): { latlng: [number, number]; altitude: number } {
  const i = indexAtDistance(profile, m);
  const j = Math.min(i + 1, profile.points - 1);
  const span = profile.distance[j] - profile.distance[i];
  const t =
    span > 0 ? Math.max(0, Math.min(1, (m - profile.distance[i]) / span)) : 0;
  const lerp = (a: number, b: number) => a + t * (b - a);
  return {
    latlng: [
      lerp(profile.latlng[i][0], profile.latlng[j][0]),
      lerp(profile.latlng[i][1], profile.latlng[j][1]),
    ],
    altitude: lerp(profile.altitude[i], profile.altitude[j]),
  };
}

/** The route between two distances, for drawing a segment on the map. */
export function sliceRoute(
  profile: CorridorProfile,
  fromM: number,
  toM: number,
): [number, number][] {
  const a = pointAtDistance(profile, fromM).latlng;
  const b = pointAtDistance(profile, toM).latlng;
  const i = indexAtDistance(profile, fromM) + 1;
  const j = indexAtDistance(profile, toM);
  return [a, ...profile.latlng.slice(i, j + 1), b];
}
