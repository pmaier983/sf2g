/**
 * Route classification system.
 *
 * 3-layer classification:
 * 0. Commute filter — ride must start in SF and end in the peninsula corridor (or vice versa)
 * 1. Gateway layer — checks if decoded polyline points pass within 500m of gateway checkpoints
 * 2. Elevation fallback — uses elevation gain + start/end location heuristics
 *
 * Exports: `classifyRoute(activity)` → `ClassificationResult`
 */

import { decodePolyline } from './polyline'
import {
  ROUTE_GATEWAYS,
  GATEWAY_RADIUS_METERS,
  SF_BOUNDS,
  PENINSULA_CORRIDOR,
  type RouteGateway,
} from './constants'
import type { RouteCategory, ClassificationMethod } from './database.types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  category: RouteCategory | null
  confidence: number
  method: ClassificationMethod
  matchedGateways?: string[]
}

/**
 * Minimal activity shape needed for classification.
 * This is a subset of the Strava activity summary.
 */
export interface ClassifiableActivity {
  /** Google encoded polyline string */
  summary_polyline?: string | null
  /** Total distance in meters */
  distance?: number | null
  /** Total elevation gain in meters */
  total_elevation_gain?: number | null
  /** Start coordinates [lat, lng] */
  start_latlng?: [number, number] | null
  /** End coordinates [lat, lng] */
  end_latlng?: [number, number] | null
}

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000

/**
 * Calculate the haversine distance between two lat/lng points.
 * @returns Distance in meters
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_METERS * c
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
  const matched: RouteGateway[] = []

  for (const gateway of gateways) {
    for (const [lat, lng] of points) {
      if (
        haversineDistance(lat, lng, gateway.lat, gateway.lng) <=
        GATEWAY_RADIUS_METERS
      ) {
        matched.push(gateway)
        break // One match per gateway is enough
      }
    }
  }

  return matched
}

/**
 * Layer 1: Classify by gateway proximity.
 * Returns null if no gateways matched.
 */
function classifyByGateways(
  activity: ClassifiableActivity,
): ClassificationResult | null {
  if (!activity.summary_polyline) return null

  const points = decodePolyline(activity.summary_polyline)
  if (points.length === 0) return null

  const matched = findMatchedGateways(points, ROUTE_GATEWAYS)
  if (matched.length === 0) return null

  const matchedNames = matched.map((g) => g.name)

  // Count gateway hits per route category
  const hitsByCategory = new Map<RouteCategory, number>()
  for (const gateway of matched) {
    hitsByCategory.set(
      gateway.category,
      (hitsByCategory.get(gateway.category) ?? 0) + 1,
    )
  }

  // Find the category with the most gateway hits
  let bestCategory: RouteCategory = 'other'
  let bestHits = 0
  for (const [category, hits] of hitsByCategory) {
    if (hits > bestHits) {
      bestCategory = category
      bestHits = hits
    }
  }

  // Only one route matched
  if (hitsByCategory.size === 1) {
    return {
      category: bestCategory,
      confidence: bestHits >= 2 ? 0.95 : 0.80,
      method: 'gateway',
      matchedGateways: matchedNames,
    }
  }

  // Multiple routes matched — pick the one with the most gateway hits
  return {
    category: bestCategory,
    confidence: 0.70,
    method: 'gateway',
    matchedGateways: matchedNames,
  }
}

// ---------------------------------------------------------------------------
// Layer 2: Elevation Fallback
// ---------------------------------------------------------------------------

/** Minimum distance (40km) required for elevation-based classification */
const MIN_DISTANCE_METERS = 40_000

/**
 * Layer 2: Classify by elevation gain + start/end location heuristics.
 * Only attempted if Layer 1 found no gateway match AND distance ≥ 40km.
 */
function classifyByElevation(
  activity: ClassifiableActivity,
): ClassificationResult | null {
  const distance = activity.distance ?? 0
  const elevGain = activity.total_elevation_gain ?? 0

  // Distance filter: must be at least 40km to be an SF2G commute
  if (distance < MIN_DISTANCE_METERS) return null

  // Skyline: heavy climbing (>2500m elevation gain)
  if (elevGain > 2500) {
    return {
      category: 'skyline',
      confidence: 0.5,
      method: 'elevation',
    }
  }

  // HMBW: moderate climbing (>2000m) + western start
  // Western start means start longitude < -122.45 (coastal side)
  const startLng = activity.start_latlng?.[1] ?? 0
  if (elevGain > 2000 && startLng < -122.45) {
    return {
      category: 'hmbw',
      confidence: 0.4,
      method: 'elevation',
    }
  }

  // Bayway: flat route (<1000m elevation gain) + eastern end
  // Eastern end means end longitude > -122.35 (bay side)
  const endLng = activity.end_latlng?.[1] ?? 0
  if (elevGain < 1000 && endLng > -122.35) {
    return {
      category: 'bayway',
      confidence: 0.4,
      method: 'elevation',
    }
  }

  // Royale: relatively flat (<1200m elevation gain)
  if (elevGain < 1200) {
    return {
      category: 'royale',
      confidence: 0.3,
      method: 'elevation',
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Layer 0: Commute Endpoint Filter
// ---------------------------------------------------------------------------

/**
 * Check if a coordinate is within the San Francisco city bounds.
 */
export function isInSF(latlng: [number, number] | null | undefined): boolean {
  if (!latlng) return false
  const [lat, lng] = latlng
  return (
    lat >= SF_BOUNDS.south &&
    lat <= SF_BOUNDS.north &&
    lng >= SF_BOUNDS.west &&
    lng <= SF_BOUNDS.east
  )
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
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Check if a coordinate is within the peninsula corridor
 * (between Hwy 280 and Hwy 101, with ~1mi buffer on each side,
 * from Daly City to San Jose).
 */
export function isInPeninsulaCorridor(
  latlng: [number, number] | null | undefined,
): boolean {
  if (!latlng) return false
  return isPointInPolygon(latlng[0], latlng[1], PENINSULA_CORRIDOR)
}

/**
 * Check if a ride is a commutable SF2G route.
 * One endpoint must be in SF and the other in the peninsula corridor.
 */
export function isCommutableRoute(activity: ClassifiableActivity): boolean {
  const startInSF = isInSF(activity.start_latlng)
  const endInSF = isInSF(activity.end_latlng)
  const startInCorridor = isInPeninsulaCorridor(activity.start_latlng)
  const endInCorridor = isInPeninsulaCorridor(activity.end_latlng)

  return (startInSF && endInCorridor) || (startInCorridor && endInSF)
}

// ---------------------------------------------------------------------------
// Main Classification Entry Point
// ---------------------------------------------------------------------------

/**
 * Classify a Strava activity into an SF2G route category.
 *
 * Uses a 3-layer approach:
 * 0. Commute filter: one endpoint must be in SF, the other in the peninsula corridor
 * 1. Gateway layer: check if decoded polyline passes within 500m of known gateway checkpoints
 * 2. Elevation fallback: use elevation gain + start/end location heuristics
 *
 * If the ride doesn't pass the commute filter, returns `{ category: null }`.
 * If it passes the commute filter but no classification layer matches,
 * returns `{ category: 'other', confidence: 0 }` (valid SF2G, unknown route).
 */
export function classifyRoute(activity: ClassifiableActivity): ClassificationResult {
  // Layer 0: Commute endpoint filter
  // Non-SF2G rides get null category — they are NOT "other" SF2G rides
  if (!isCommutableRoute(activity)) {
    return {
      category: null,
      confidence: 0,
      method: 'gateway',
    }
  }

  // Layer 1: Gateway-based classification (highest priority)
  const gatewayResult = classifyByGateways(activity)
  if (gatewayResult) return gatewayResult

  // Layer 2: Elevation-based fallback
  const elevationResult = classifyByElevation(activity)
  if (elevationResult) return elevationResult

  // Fallback: unclassified
  return {
    category: 'other',
    confidence: 0,
    method: 'gateway',
  }
}
