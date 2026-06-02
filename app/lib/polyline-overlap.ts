/**
 * Polyline intersection analysis for co-ride detection.
 *
 * Given two Google Encoded Polyline strings (from Strava's `summary_polyline`),
 * computes the spatial overlap ratio — i.e., what fraction of one route's GPS
 * points fall within a proximity threshold of the other route.
 *
 * Reuses the existing `decodePolyline()` from ./polyline and a haversine
 * distance function consistent with the route-classifier approach.
 */
import { decodePolyline } from './polyline'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Two GPS points are considered "overlapping" if within this distance */
const PROXIMITY_THRESHOLD_METERS = 200

/** Maximum sample points to check from each polyline (for performance) */
const MAX_SAMPLES = 50

/** Earth radius in meters (WGS84 mean) */
const EARTH_RADIUS_METERS = 6_371_000

// ---------------------------------------------------------------------------
// Haversine distance (mirrors route-classifier.ts)
// ---------------------------------------------------------------------------

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
// Polyline overlap
// ---------------------------------------------------------------------------

/**
 * Compute the spatial overlap ratio between two encoded polylines.
 *
 * Decodes both polylines, samples points from the shorter one,
 * and checks what percentage of sampled points are within
 * PROXIMITY_THRESHOLD_METERS of any point on the other polyline.
 *
 * @param encoded1 - First Google Encoded Polyline string
 * @param encoded2 - Second Google Encoded Polyline string
 * @returns Overlap ratio 0.0 to 1.0 (0 = no overlap, 1 = fully overlapping)
 */
export function computePolylineOverlap(
  encoded1: string | null | undefined,
  encoded2: string | null | undefined,
): number {
  if (!encoded1 || !encoded2) return 0

  const points1 = decodePolyline(encoded1)
  const points2 = decodePolyline(encoded2)
  if (points1.length === 0 || points2.length === 0) return 0

  // Determine shorter/longer polyline for efficiency
  const [shorter, longer] =
    points1.length <= points2.length ? [points1, points2] : [points2, points1]

  // Sample every Nth point from the shorter polyline to cap computation
  const sampleRate = Math.max(1, Math.floor(shorter.length / MAX_SAMPLES))
  const sampled = shorter.filter((_, i) => i % sampleRate === 0)

  // Also subsample the longer polyline for comparison (avoid O(n*m) full scan)
  const longerSampleRate = Math.max(
    1,
    Math.floor(longer.length / (MAX_SAMPLES * 3)),
  )
  const longerSampled = longer.filter((_, i) => i % longerSampleRate === 0)

  let overlapping = 0

  for (const [lat1, lng1] of sampled) {
    // Quick bounding-box pre-filter: skip if clearly too far from any point
    // (rough check: ~0.002 degrees ≈ 200m at mid-latitudes)
    let found = false
    for (const [lat2, lng2] of longerSampled) {
      // Quick lat/lng difference check before expensive haversine
      if (Math.abs(lat1 - lat2) > 0.003 || Math.abs(lng1 - lng2) > 0.004) {
        continue
      }
      if (
        haversineDistance(lat1, lng1, lat2, lng2) <= PROXIMITY_THRESHOLD_METERS
      ) {
        found = true
        break
      }
    }
    if (found) {
      overlapping++
    }
  }

  return sampled.length > 0 ? overlapping / sampled.length : 0
}
