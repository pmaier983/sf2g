/**
 * Reference implementation of the PPR-at-dawn rule as it ran in TypeScript
 * before migration 037 moved it into SQL (sf2g_is_ppr_dawn). Kept only so
 * sql-ports.test.ts can prove the port agrees ride by ride.
 *
 * Copied from app/server/leaderboard.ts (fetchPprDawnRiderIds) and the
 * ppr_dawn_rides view's 04:00–07:59 local-start window.
 */
import { PPR_INTERCEPTS } from "../../lib/constants";
import { decodePolyline } from "../../lib/polyline";

const EARTH_RADIUS_METERS = 6_371_000;
const PPR_RADIUS_METERS = 500;

function extractTimezone(tz: string | null | undefined): string {
  if (!tz) return "America/Los_Angeles";
  const match = tz.match(/\)\s*(.+)$/);
  return match?.[1]?.trim() || "America/Los_Angeles";
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localHour(date: Date, tz: string): number {
  const s = date.toLocaleString("en-US", { timeZone: tz, hour12: false });
  return parseInt(s.split(", ")[1]?.split(":")[0] ?? "0", 10);
}

export interface PprRideInput {
  summary_polyline: string | null;
  start_date: string;
  timezone: string | null;
  moving_time_seconds: number | null;
}

export function isPprDawnReference(ride: PprRideInput): boolean {
  if (!ride.summary_polyline) return false;
  const tz = extractTimezone(ride.timezone);
  const start = new Date(ride.start_date);

  // ppr_dawn_rides window: local start hour 4..7
  const h = localHour(start, tz);
  if (h < 4 || h > 7) return false;

  const points = decodePolyline(ride.summary_polyline);
  if (points.length === 0) return false;

  for (const intercept of PPR_INTERCEPTS) {
    let arrival: Date | null = null;
    for (let i = 0; i < points.length; i++) {
      const [lat, lng] = points[i];
      const dLat = lat - intercept.lat;
      const dLng = lng - intercept.lng;
      if (dLat * dLat + dLng * dLng > 2.5e-5) continue;
      if (
        haversineDistance(lat, lng, intercept.lat, intercept.lng) <=
        PPR_RADIUS_METERS
      ) {
        const fraction = points.length > 1 ? i / (points.length - 1) : 0;
        arrival = new Date(
          start.getTime() + fraction * (ride.moving_time_seconds ?? 0) * 1000,
        );
        break;
      }
    }
    if (!arrival) continue;

    const parts =
      arrival
        .toLocaleString("en-US", { timeZone: tz, hour12: false })
        .split(", ")[1]
        ?.split(":") ?? [];
    const minutes =
      parseInt(parts[0] ?? "0", 10) * 60 + parseInt(parts[1] ?? "0", 10);
    if (
      minutes >= intercept.targetMinutes - 10 &&
      minutes <= intercept.targetMinutes + 10
    ) {
      return true;
    }
  }
  return false;
}
