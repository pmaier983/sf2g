/**
 * Route classification system.
 *
 * 2-layer classification:
 * 0. Commute filter — ride must start in SF and end in the peninsula corridor (or vice versa),
 *    and be ridden the whole way (no train/car leg)
 * 1. Gateway layer — checks if decoded polyline points pass within 500m of gateway checkpoints
 *
 * A commute that matches no gateway is "other": an SF2G on an unknown route.
 *
 * Exports: `classifyRoute(activity)` → `ClassificationResult`
 */

import { decodePolyline } from "./polyline";
import {
  ROUTE_GATEWAYS,
  GATEWAY_RADIUS_METERS,
  SF_BOUNDS,
  PENINSULA_CORRIDOR,
  type RouteGateway,
} from "./constants";
import type { RouteCategory, ClassificationMethod } from "./database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  category: RouteCategory | null;
  confidence: number;
  method: ClassificationMethod;
  matchedGateways?: string[];
}

/**
 * Minimal activity shape needed for classification.
 * This is a subset of the Strava activity summary.
 */
export interface ClassifiableActivity {
  /** Google encoded polyline string */
  summary_polyline?: string | null;
  /** Total distance in meters */
  distance?: number | null;
  /** Total elevation gain in meters */
  total_elevation_gain?: number | null;
  /** Start coordinates [lat, lng] */
  start_latlng?: [number, number] | null;
  /** End coordinates [lat, lng] */
  end_latlng?: [number, number] | null;
}

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Calculate the haversine distance between two lat/lng points.
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

// ---------------------------------------------------------------------------
// Layer 1: Gateway Classification
// ---------------------------------------------------------------------------

/**
 * Check if any point in the polyline passes within GATEWAY_RADIUS_METERS
 * of each gateway checkpoint.
 */
function findMatchedGateways(
  points: [number, number][],
  gateways: RouteGateway[],
): RouteGateway[] {
  const matched: RouteGateway[] = [];

  for (const gateway of gateways) {
    for (const [lat, lng] of points) {
      if (
        haversineDistance(lat, lng, gateway.lat, gateway.lng) <=
        GATEWAY_RADIUS_METERS
      ) {
        matched.push(gateway);
        break; // One match per gateway is enough
      }
    }
  }

  return matched;
}

/**
 * Layer 1: Classify by gateway proximity.
 * Returns null if no gateways matched.
 */
function classifyByGateways(
  points: [number, number][],
): ClassificationResult | null {
  if (points.length === 0) return null;

  const matched = findMatchedGateways(points, ROUTE_GATEWAYS);
  if (matched.length === 0) return null;

  const matchedNames = matched.map((g) => g.name);

  // Count gateway hits per route category
  const hitsByCategory = new Map<RouteCategory, number>();
  for (const gateway of matched) {
    hitsByCategory.set(
      gateway.category,
      (hitsByCategory.get(gateway.category) ?? 0) + 1,
    );
  }

  // Find the category with the most gateway hits
  let bestCategory: RouteCategory = "other";
  let bestHits = 0;
  for (const [category, hits] of hitsByCategory) {
    if (hits > bestHits) {
      bestCategory = category;
      bestHits = hits;
    }
  }

  // Only one route matched
  if (hitsByCategory.size === 1) {
    return {
      category: bestCategory,
      confidence: bestHits >= 2 ? 0.95 : 0.8,
      method: "gateway",
      matchedGateways: matchedNames,
    };
  }

  // Multiple routes matched — if bestCategory has >=2 hits and more hits than 2nd place
  const sortedHits = Array.from(hitsByCategory.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  const secondHits = sortedHits[1]?.[1] ?? 0;
  const isClearWinner = bestHits >= 2 && bestHits > secondHits;

  return {
    category: bestCategory,
    confidence: isClearWinner ? 0.95 : 0.7,
    method: "gateway",
    matchedGateways: matchedNames,
  };
}

// ---------------------------------------------------------------------------
// Layer 0: Commute Endpoint Filter
// ---------------------------------------------------------------------------

/**
 * Check if a coordinate is within the San Francisco city bounds.
 */
export function isInSF(latlng: [number, number] | null | undefined): boolean {
  if (!latlng) return false;
  const [lat, lng] = latlng;
  return (
    lat >= SF_BOUNDS.south &&
    lat <= SF_BOUNDS.north &&
    lng >= SF_BOUNDS.west &&
    lng <= SF_BOUNDS.east
  );
}

/**
 * Ray-casting point-in-polygon test.
 * @returns true if the point (lat, lng) is inside the polygon
 */
function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][],
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if a coordinate is within the peninsula corridor
 * (between Hwy 280 and Hwy 101, with ~1mi buffer on each side,
 * from Daly City to San Jose).
 */
export function isInPeninsulaCorridor(
  latlng: [number, number] | null | undefined,
): boolean {
  if (!latlng) return false;
  return isPointInPolygon(latlng[0], latlng[1], PENINSULA_CORRIDOR);
}

/**
 * Longest gap between consecutive polyline points that is still riding.
 * Strava's summary polylines keep a point every few km on real rides (the
 * fixture tops out near 6 km; 12 km on a straight road). A Caltrain leg
 * recorded as part of the activity shows up as one 40–55 km jump.
 */
const MAX_RIDDEN_GAP_METERS = 15_000;

/**
 * True when the track jumps further than anyone rides between two GPS
 * points: the activity includes a train or car leg.
 */
function hasTransitLeg(points: [number, number][]): boolean {
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    if (haversineDistance(lat1, lng1, lat2, lng2) > MAX_RIDDEN_GAP_METERS) {
      return true;
    }
  }
  return false;
}

function decodeActivityPolyline(
  activity: ClassifiableActivity,
): [number, number][] {
  return activity.summary_polyline
    ? decodePolyline(activity.summary_polyline)
    : [];
}

function isCommutableTrack(
  activity: ClassifiableActivity,
  points: [number, number][],
): boolean {
  if (getCommuteDirection(activity.start_latlng, activity.end_latlng) === null)
    return false;
  return !hasTransitLeg(points);
}

/**
 * Check if a ride is a commutable SF2G route.
 * One endpoint must be in SF and the other in the peninsula corridor, and the
 * whole way must be ridden: a ride to 4th & King, Caltrain to Mountain View
 * and a ride to the office has SF2G endpoints but is not an SF2G.
 */
export function isCommutableRoute(activity: ClassifiableActivity): boolean {
  return isCommutableTrack(activity, decodeActivityPolyline(activity));
}

/**
 * Determine the commute direction of a ride.
 * @returns 'sf2g' if SF→Peninsula, 'g2sf' if Peninsula→SF, null if not a commute
 */
export function getCommuteDirection(
  startLatlng: [number, number] | null | undefined,
  endLatlng: [number, number] | null | undefined,
): "sf2g" | "g2sf" | null {
  const startInSF = isInSF(startLatlng);
  const endInCorridor = isInPeninsulaCorridor(endLatlng);
  const startInCorridor = isInPeninsulaCorridor(startLatlng);
  const endInSF = isInSF(endLatlng);

  if (startInSF && endInCorridor) return "sf2g";
  if (startInCorridor && endInSF) return "g2sf";
  return null;
}

// ---------------------------------------------------------------------------
// Main Classification Entry Point
// ---------------------------------------------------------------------------

/**
 * Classify a Strava activity into an SF2G route category.
 *
 * Uses a 2-layer approach:
 * 0. Commute filter: one endpoint must be in SF, the other in the peninsula
 *    corridor, with no train/car leg in between
 * 1. Gateway layer: check if decoded polyline passes within 500m of known gateway checkpoints
 *
 * If the ride doesn't pass the commute filter, returns `{ category: null }`.
 * If it passes the commute filter but no classification layer matches,
 * returns `{ category: 'other', confidence: 0 }` (valid SF2G, unknown route).
 */
export function classifyRoute(
  activity: ClassifiableActivity,
): ClassificationResult {
  // Layer 0: Commute endpoint filter
  // Non-SF2G rides get null category — they are NOT "other" SF2G rides
  const points = decodeActivityPolyline(activity);
  if (!isCommutableTrack(activity, points)) {
    return {
      category: null,
      confidence: 0,
      method: "gateway",
    };
  }

  // Layer 1: Gateway-based classification (highest priority)
  const gatewayResult = classifyByGateways(points);
  if (gatewayResult) return gatewayResult;

  // No gateway: an SF2G on an unknown route. Elevation and endpoints can't
  // tell the routes apart (a flat Skyline and a Bayway end at the same
  // office), so don't guess.
  return {
    category: "other",
    confidence: 0,
    method: "gateway",
  };
}
