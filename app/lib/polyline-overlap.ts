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
import { decodePolyline } from "./polyline";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Two GPS points are considered "overlapping" if within this distance */
const PROXIMITY_THRESHOLD_METERS = 200;

/** Maximum sample points to check from each polyline (for performance) */
const MAX_SAMPLES = 50;

/** Earth radius in meters (WGS84 mean) */
const EARTH_RADIUS_METERS = 6_371_000;

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
// Polyline decode & sample cache
// ---------------------------------------------------------------------------

interface CachedPolyline {
  sampled: [number, number][];
  longerSampled: [number, number][];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const polylineCache = new Map<string, CachedPolyline>();
const MAX_CACHE_SIZE = 3000;

function getCachedPolyline(encoded: string): CachedPolyline | null {
  const cached = polylineCache.get(encoded);
  if (cached) return cached;

  const points = decodePolyline(encoded);
  if (points.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const sampleRate = Math.max(1, Math.floor(points.length / 25));
  const sampled = points.filter((_, i) => i % sampleRate === 0);

  const longerSampleRate = Math.max(1, Math.floor(points.length / 50));
  const longerSampled = points.filter((_, i) => i % longerSampleRate === 0);

  const entry: CachedPolyline = {
    sampled,
    longerSampled,
    minLat,
    maxLat,
    minLng,
    maxLng,
  };

  if (polylineCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest quarter of entries when limit reached
    const keysToDelete = Array.from(polylineCache.keys()).slice(
      0,
      Math.floor(MAX_CACHE_SIZE / 4),
    );
    for (const key of keysToDelete) {
      polylineCache.delete(key);
    }
  }

  polylineCache.set(encoded, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Polyline overlap
// ---------------------------------------------------------------------------

/**
 * Compute the spatial overlap ratio between two encoded polylines.
 *
 * Decodes both polylines (with memory caching), checks bounding-box overlap,
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
  if (!encoded1 || !encoded2) return 0;
  if (encoded1 === encoded2) return 1; // Identical route

  const poly1 = getCachedPolyline(encoded1);
  const poly2 = getCachedPolyline(encoded2);
  if (!poly1 || !poly2) return 0;

  // Fast bounding-box rejection (~0.003 deg ≈ 300m)
  if (
    poly1.minLat - 0.003 > poly2.maxLat ||
    poly1.maxLat + 0.003 < poly2.minLat ||
    poly1.minLng - 0.004 > poly2.maxLng ||
    poly1.maxLng + 0.004 < poly2.minLng
  ) {
    return 0;
  }

  // Determine shorter/longer sampled sets
  const [sampled, longerSampled] =
    poly1.sampled.length <= poly2.sampled.length
      ? [poly1.sampled, poly2.longerSampled]
      : [poly2.sampled, poly1.longerSampled];

  let overlapping = 0;

  for (const [lat1, lng1] of sampled) {
    let found = false;
    for (const [lat2, lng2] of longerSampled) {
      const dLat = lat1 - lat2;
      const dLng = (lng1 - lng2) * 0.793; // approx cos(37.5 deg) at Bay Area latitude
      const distSq = dLat * dLat + dLng * dLng;

      // 200m is ~0.0018 deg -> squared is ~3.24e-6
      if (distSq > 0.0000035) {
        continue;
      }

      if (
        haversineDistance(lat1, lng1, lat2, lng2) <= PROXIMITY_THRESHOLD_METERS
      ) {
        found = true;
        break;
      }
    }
    if (found) {
      overlapping++;
    }
  }

  return sampled.length > 0 ? overlapping / sampled.length : 0;
}
