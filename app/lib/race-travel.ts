/**
 * Rough "how do I get to this race" estimate from a chosen origin.
 *
 * From San Francisco (City Hall) the data file already has exact OSRM drive
 * figures, so those are used as-is. From anywhere else the estimate is
 * straight-line distance × a road factor, with drive time at a highway pace;
 * both constants were fitted to the OSRM figures in races-2027.json
 * (road/straight-line ratio 1.09–1.35, median ~1.2; drive time ≈ 10 min +
 * road miles at 55 mph, within a few minutes from 3 to 3,000 mi).
 *
 * Runs in the browser only; nothing here touches the Worker.
 */
import { formatDriveMinutes, type RaceEvent } from "./races";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Origin extends LatLng {
  label: string;
  /** The data file's OSRM drive figures were computed from this point. */
  exact: boolean;
}

export type TravelMode = "bike" | "drive" | "overnight" | "flight";

export interface Travel {
  mode: TravelMode;
  /** Door-to-door minutes for the chosen mode. */
  minutes: number;
  /** Road miles (driving distance), used for sorting and display. */
  roadMi: number;
  /** False only when the figures are the exact OSRM drive from SF. */
  estimated: boolean;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Ride there when the road distance is at most this. */
export const BIKE_MAX_MI = 25;
/** A drive up to this long is a race-morning day trip. */
export const DAY_DRIVE_MAX_MIN = 4 * 60;
/** Beyond this many road miles, fly. Matches the old "likely a flight". */
export const FLIGHT_MIN_MI = 600;

const ROAD_FACTOR = 1.2;
const DRIVE_MPH = 55;
const DRIVE_OVERHEAD_MIN = 10;
const BIKE_MPH = 14;
const FLIGHT_MPH = 450;
/** Getting to the airport, security, boarding, rental car at the far end. */
const FLIGHT_OVERHEAD_MIN = 150;

export const TRAVEL_MODES: Record<
  TravelMode,
  { emoji: string; label: string; rule: string }
> = {
  bike: {
    emoji: "🚲",
    label: "Bike",
    rule: `${BIKE_MAX_MI} mi or less by road, at ${BIKE_MPH} mph`,
  },
  drive: {
    emoji: "🚗",
    label: "Drive",
    rule: `up to ${DAY_DRIVE_MAX_MIN / 60} h, a race-morning day trip`,
  },
  overnight: {
    emoji: "🌙",
    label: "Overnight drive",
    rule: `over ${DAY_DRIVE_MAX_MIN / 60} h; drive the day before`,
  },
  flight: {
    emoji: "✈️",
    label: "Flight",
    rule: `over ${FLIGHT_MIN_MI} road miles; air time plus ${FLIGHT_OVERHEAD_MIN / 60} h of airports`,
  },
};

export const TRAVEL_MODE_ORDER: TravelMode[] = [
  "bike",
  "drive",
  "overnight",
  "flight",
];

export function travelModeFor(roadMi: number, driveMin: number): TravelMode {
  if (roadMi <= BIKE_MAX_MI) return "bike";
  if (roadMi > FLIGHT_MIN_MI) return "flight";
  if (driveMin > DAY_DRIVE_MAX_MIN) return "overnight";
  return "drive";
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in statute miles. */
export function greatCircleMi(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateTravel(
  event: RaceEvent,
  origin: Origin,
): Travel | null {
  if (event.lat === null || event.lng === null) return null;
  const venue = { lat: event.lat, lng: event.lng };
  const airMi = greatCircleMi(origin, venue);

  const exact = origin.exact && event.drive !== null;
  const roadMi = exact ? event.drive!.mi : Math.round(airMi * ROAD_FACTOR);
  const driveMin = exact
    ? event.drive!.min
    : Math.round(DRIVE_OVERHEAD_MIN + (roadMi / DRIVE_MPH) * 60);

  const mode = travelModeFor(roadMi, driveMin);
  switch (mode) {
    case "bike":
      return {
        mode,
        roadMi,
        minutes: Math.round((roadMi / BIKE_MPH) * 60),
        estimated: !exact,
      };
    case "flight":
      return {
        mode,
        roadMi,
        minutes: Math.round(FLIGHT_OVERHEAD_MIN + (airMi / FLIGHT_MPH) * 60),
        estimated: true,
      };
    default:
      return { mode, roadMi, minutes: driveMin, estimated: !exact };
  }
}

/** 13 → "13 min", 111 → "1 h 51"; estimates get a leading "~". */
export function formatTravelTime(minutes: number, estimated: boolean): string {
  const body = minutes < 60 ? `${minutes} min` : formatDriveMinutes(minutes);
  return estimated ? `~${body}` : body;
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

export const DEFAULT_ORIGIN: Origin = {
  label: "San Francisco",
  lat: 37.7793,
  lng: -122.4193,
  exact: true,
};

const place = (label: string, lat: number, lng: number): Origin => ({
  label,
  lat,
  lng,
  exact: false,
});

/** Places offered in the "From" box. Free text must match one of these. */
export const ORIGIN_PRESETS: Origin[] = [
  DEFAULT_ORIGIN,
  place("Oakland", 37.8044, -122.2712),
  place("Berkeley", 37.8716, -122.2727),
  place("San Rafael", 37.9735, -122.5311),
  place("Walnut Creek", 37.9101, -122.0652),
  place("Palo Alto", 37.4419, -122.143),
  place("Mountain View", 37.3861, -122.0839),
  place("San Jose", 37.3382, -121.8863),
  place("Santa Cruz", 36.9741, -122.0308),
  place("Santa Rosa", 38.4405, -122.7144),
  place("Sacramento", 38.5816, -121.4944),
  place("Davis", 38.5449, -121.7405),
  place("Fresno", 36.7378, -119.7871),
  place("San Luis Obispo", 35.2828, -120.6596),
  place("Santa Barbara", 34.4208, -119.6982),
  place("Los Angeles", 34.0522, -118.2437),
  place("San Diego", 32.7157, -117.1611),
  place("Reno", 39.5296, -119.8138),
  place("Portland", 45.5152, -122.6784),
  place("Seattle", 47.6062, -122.3321),
];

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** A preset by name (any case), or "lat, lng" typed by hand. */
export function findOrigin(text: string): Origin | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const preset = ORIGIN_PRESETS.find((o) => o.label.toLowerCase() === q);
  if (preset) return preset;
  const m = COORDS.exec(text);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return place(`${lat}, ${lng}`, lat, lng);
    }
  }
  return null;
}
