/**
 * Flat / hilly / one-big-climb, from a course's one-lap elevation profile.
 *
 * Thresholds were checked against the hand-written course notes in
 * races-2027.json: Patterson Pass, Copperopolis and Winters RR are the
 * one-climb courses; Pescadero and Berkeley Hills have several climbs, none
 * dominant; a crit with one 30 ft rise per lap is still flat.
 *
 * Pure and cheap (36 courses × ~121 samples), so it runs in the browser.
 */
import type { DistanceUnit, RaceCourse } from "./races";

export type TerrainKind = "flat" | "hilly" | "climb";

export interface Terrain {
  kind: TerrainKind;
  /** Lap climbing ÷ lap distance, rounded. */
  ftPerMi: number;
  /** Largest sustained rise on the lap (a dip under 25 ft doesn't end it). */
  biggestClimbFt: number;
  /** Average grade of that climb, 0–1. */
  biggestClimbGrade: number;
}

export const TERRAIN_KINDS: Record<
  TerrainKind,
  { emoji: string; label: string; rule: string }
> = {
  flat: {
    emoji: "➖",
    label: "Flat",
    rule: "No climb over 300 ft and no repeated steep rises",
  },
  hilly: {
    emoji: "〰️",
    label: "Hilly",
    rule: "Several climbs, or over 50 ft of climbing per mile",
  },
  climb: {
    emoji: "⛰️",
    label: "Big climb",
    rule: "One sustained climb of 500+ ft holds most of the lap's climbing",
  },
};

export const TERRAIN_ORDER: TerrainKind[] = ["flat", "hilly", "climb"];

/** A descent bigger than this ends a climb. */
const DIP_TOLERANCE_FT = 25;
const BIG_CLIMB_MIN_FT = 500;
const BIG_CLIMB_MIN_SHARE = 0.55;
const BIG_CLIMB_MIN_GRADE = 0.02;
const HILLY_FT_PER_MI = 50;
/** Below this, a steep ft/mi is just one small bump on a short crit lap. */
const HILLY_MIN_CLIMB_FT = 40;
const HILLY_ANY_CLIMB_FT = 300;

interface Climb {
  ft: number;
  from: number;
  to: number;
}

function biggestClimb(profile: number[], tolerance: number): Climb {
  let best: Climb = { ft: 0, from: 0, to: 0 };
  let lo = 0;
  let hi = 0;
  const close = () => {
    const ft = profile[hi] - profile[lo];
    if (ft > best.ft) best = { ft, from: lo, to: hi };
  };
  for (let i = 1; i < profile.length; i++) {
    if (profile[i] > profile[hi]) hi = i;
    if (profile[hi] - profile[i] > tolerance) {
      close();
      lo = i;
      hi = i;
    }
    if (profile[i] < profile[lo]) {
      lo = i;
      hi = i;
    }
  }
  close();
  return best;
}

/** Height of the largest sustained climb in a profile (ft). */
export function biggestClimbFt(
  profile: number[],
  tolerance = DIP_TOLERANCE_FT,
): number {
  return biggestClimb(profile, tolerance).ft;
}

export function climbingPerMile(c: RaceCourse): number {
  return c.lapMi > 0 ? Math.round(c.lapGainFt / c.lapMi) : 0;
}

export function courseTerrain(c: RaceCourse): Terrain {
  const n = c.profileFt.length;
  // Laps are loops: run the profile twice so a climb over the line counts.
  const twice = [...c.profileFt, ...c.profileFt.slice(1)];
  const climb = biggestClimb(twice, DIP_TOLERANCE_FT);
  const range = c.maxFt - c.minFt;
  const ft = Math.min(climb.ft, range);
  const miPerSample = n > 1 ? c.lapMi / (n - 1) : 0;
  const lengthFt = (climb.to - climb.from) * miPerSample * 5280;
  const grade = lengthFt > 0 ? ft / lengthFt : 0;
  const ftPerMi = climbingPerMile(c);
  const share = c.lapGainFt > 0 ? ft / c.lapGainFt : 0;

  let kind: TerrainKind = "flat";
  if (
    ft >= BIG_CLIMB_MIN_FT &&
    share >= BIG_CLIMB_MIN_SHARE &&
    grade >= BIG_CLIMB_MIN_GRADE
  ) {
    kind = "climb";
  } else if (
    (ftPerMi >= HILLY_FT_PER_MI && ft >= HILLY_MIN_CLIMB_FT) ||
    ft >= HILLY_ANY_CLIMB_FT
  ) {
    kind = "hilly";
  }
  return {
    kind,
    ftPerMi,
    biggestClimbFt: Math.round(ft),
    biggestClimbGrade: grade,
  };
}

/** 90 ft/mi → "90 ft/mi" or "17 m/km". */
export function formatClimbingRate(
  ftPerMi: number,
  unit: DistanceUnit,
): string {
  return unit === "km"
    ? `${Math.round((ftPerMi * 0.3048) / 1.609344)} m/km`
    : `${ftPerMi} ft/mi`;
}
