/**
 * Display helpers for the segment board.
 */
import type { UnitSystem } from "../components/UnitToggle";
import { METERS_PER_MILE } from "./constants";

/** Seconds → Strava-style clock: 289 → "4:49", 3731 → "1:02:11". */
export function formatSegmentTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Segment length with one decimal (segments are short). */
export function formatSegmentDistance(
  meters: number,
  unit: UnitSystem,
): string {
  return unit === "km"
    ? `${(meters / 1000).toFixed(1)} km`
    : `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
}

/** 0.933 → "93%"; null → "—". */
export function formatPctOfKom(pct: number | null | undefined): string {
  return pct == null ? "—" : `${Math.round(pct * 100)}%`;
}
