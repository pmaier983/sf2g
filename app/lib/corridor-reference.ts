/**
 * Choosing a corridor's reference ride from other riders' rides (phase 09b;
 * Phillip, 2026-11-18: "use other people's rides instead of my own").
 *
 * The most typical ride is the medoid: the one every other ride stays
 * closest to. Each candidate is scored by the median, over a sample of the
 * other rides, of how far that ride's points lie from the candidate's line
 * (mean metres). Detours, coffee stops and variants score badly.
 *
 * Pure, and run in the admin's browser (DevTools), not the Worker: scoring
 * a few hundred lines is far more than the 10 ms CPU a Worker gets.
 */
import { distanceToPolylineMeters } from "./segment-corridor";
import { haversineDistance } from "./route-classifier";

type LatLng = [number, number];

export interface CandidateLine {
  id: string;
  line: LatLng[];
}

export interface RankedCandidate {
  id: string;
  /** Median mean-distance (m) from other rides to this ride's line. */
  scoreM: number;
}

/** Lines shorter than this are not the whole route. */
const MIN_POINTS = 10;

/** Up to `n` points evenly spaced by index. */
function sample(line: LatLng[], n: number): LatLng[] {
  if (line.length <= n) return line;
  return Array.from(
    { length: n },
    (_, i) => line[Math.round((i * (line.length - 1)) / (n - 1))],
  );
}

/** Drop vertices closer than `minM` to the previous kept one (speeds up scoring). */
function thin(line: LatLng[], minM: number): LatLng[] {
  const out: LatLng[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const p = out[out.length - 1];
    if (
      haversineDistance(p[0], p[1], line[i][0], line[i][1]) >= minM ||
      i === line.length - 1
    )
      out.push(line[i]);
  }
  return out;
}

export function rankTypicalRides(
  candidates: readonly CandidateLine[],
  opts: { others?: number; points?: number } = {},
): RankedCandidate[] {
  const others = opts.others ?? 40;
  const points = opts.points ?? 25;
  const usable = [...candidates]
    .filter((c) => c.line.length >= MIN_POINTS)
    .sort((a, b) => a.id.localeCompare(b.id));
  const thinned = new Map(usable.map((c) => [c.id, thin(c.line, 100)]));
  const sampled = new Map(usable.map((c) => [c.id, sample(c.line, points)]));

  return usable
    .map((cand, ci) => {
      const ref = thinned.get(cand.id)!;
      // A deterministic spread of other rides.
      const step = Math.max(1, Math.floor((usable.length - 1) / others));
      const dists: number[] = [];
      for (let k = 1; k < usable.length && dists.length < others; k += step) {
        const other = usable[(ci + k) % usable.length];
        const pts = sampled.get(other.id)!;
        let sum = 0;
        for (const p of pts) sum += distanceToPolylineMeters(p, ref);
        dists.push(sum / pts.length);
      }
      dists.sort((a, b) => a - b);
      const mid = Math.floor(dists.length / 2);
      const median =
        dists.length === 0
          ? Infinity
          : dists.length % 2
            ? dists[mid]
            : (dists[mid - 1] + dists[mid]) / 2;
      return { id: cand.id, scoreM: Math.round(median * 10) / 10 };
    })
    .sort((a, b) => a.scoreM - b.scoreM || a.id.localeCompare(b.id));
}
