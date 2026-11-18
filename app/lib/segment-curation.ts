/**
 * Which corridor segments a cumulative board can use (phase 09a, §4.2).
 *
 * Pure: the admin action reads segment_curation_input(corridor), runs this,
 * and writes the result back with batch_update_segment_curation. Curation
 * decides only what the page offers; PRs are stored for every segment, so
 * this can be rerun at any time.
 *
 * Per direction:
 * 1. candidates: in the core, not a descent, ≥ 300 m, not hazardous, not hidden;
 * 2. duplicates: starts and ends both within 150 m along the line → keep the
 *    one with the higher ride share, then Strava athlete count, then lower id;
 * 3. ride share under 50 % is dropped unless an admin set curated_rank;
 * 4. at most 40, keeping at least 8 climbs and 8 flats when available.
 */
import {
  SEGMENT_DUPLICATE_TOLERANCE_M,
  SEGMENT_MIN_DISTANCE_M,
  SEGMENT_MIN_RIDE_SHARE,
  SEGMENT_SELECTABLE_CAP,
  SEGMENT_SELECTABLE_MIN_PER_TERRAIN,
} from "./constants";

export interface CurationCandidate {
  id: number;
  name: string;
  distance_meters: number;
  average_grade: number;
  terrain: "climb" | "flat" | "descent";
  direction: "south" | "north";
  along_start_m: number | null;
  along_end_m: number | null;
  in_core: boolean;
  hazardous: boolean;
  hidden: boolean;
  curated_rank: number | null;
  athlete_count: number | null;
  sf2g_rides: number;
  selectable: boolean;
  duplicate_of: number | null;
  /** Share of fetched rides of this route (same direction) with an effort on it. */
  ride_share: number;
}

export interface CurationRow {
  id: number;
  selectable: boolean;
  duplicate_of: number | null;
}

export interface CurationResult {
  rows: CurationRow[];
  /** Selectable per direction. */
  selected: { south: number; north: number };
  duplicates: number;
}

const isCandidate = (s: CurationCandidate) =>
  s.in_core &&
  s.terrain !== "descent" &&
  s.distance_meters >= SEGMENT_MIN_DISTANCE_M &&
  !s.hazardous &&
  !s.hidden &&
  s.along_start_m !== null &&
  s.along_end_m !== null;

/** Better first: curated, then ride share, then Strava popularity, then id. */
const preference = (a: CurationCandidate, b: CurationCandidate) =>
  Number(b.curated_rank !== null) - Number(a.curated_rank !== null) ||
  b.ride_share - a.ride_share ||
  (b.athlete_count ?? 0) - (a.athlete_count ?? 0) ||
  a.id - b.id;

function sameStretch(a: CurationCandidate, b: CurationCandidate): boolean {
  return (
    Math.abs(a.along_start_m! - b.along_start_m!) <=
      SEGMENT_DUPLICATE_TOLERANCE_M &&
    Math.abs(a.along_end_m! - b.along_end_m!) <= SEGMENT_DUPLICATE_TOLERANCE_M
  );
}

function curateDirection(
  candidates: CurationCandidate[],
  duplicateOf: Map<number, number>,
): Set<number> {
  // 2. De-duplicate: walk best-first; anything matching a kept one is its duplicate.
  const kept: CurationCandidate[] = [];
  for (const s of [...candidates].sort(preference)) {
    const twin = kept.find((k) => sameStretch(k, s));
    if (twin && s.curated_rank === null) duplicateOf.set(s.id, twin.id);
    else kept.push(s);
  }

  // 3. Ride share.
  const ridden = kept.filter(
    (s) => s.curated_rank !== null || s.ride_share >= SEGMENT_MIN_RIDE_SHARE,
  );

  // 4. Cap, with a floor per terrain.
  const chosen = new Set<number>();
  for (const terrain of ["climb", "flat"] as const) {
    ridden
      .filter((s) => s.terrain === terrain)
      .slice(0, SEGMENT_SELECTABLE_MIN_PER_TERRAIN)
      .forEach((s) => chosen.add(s.id));
  }
  // Curated segments are always in, even past the cap.
  ridden
    .filter((s) => s.curated_rank !== null)
    .forEach((s) => chosen.add(s.id));
  for (const s of ridden) {
    if (chosen.size >= SEGMENT_SELECTABLE_CAP) break;
    chosen.add(s.id);
  }
  return chosen;
}

export function curateSegments(
  segments: readonly CurationCandidate[],
): CurationResult {
  const duplicateOf = new Map<number, number>();
  const chosen = new Set<number>();
  const selected = { south: 0, north: 0 };
  for (const direction of ["south", "north"] as const) {
    const picked = curateDirection(
      segments.filter((s) => s.direction === direction && isCandidate(s)),
      duplicateOf,
    );
    selected[direction] = picked.size;
    picked.forEach((id) => chosen.add(id));
  }
  const rows = [...segments]
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      selectable: chosen.has(s.id),
      duplicate_of: duplicateOf.get(s.id) ?? null,
    }));
  return { rows, selected, duplicates: duplicateOf.size };
}
