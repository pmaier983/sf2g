/**
 * Google Encoded Polyline decoder.
 *
 * Decodes a Google Encoded Polyline string into an array of [lat, lng] pairs.
 * Uses the @mapbox/polyline package under the hood.
 *
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
import polyline from '@mapbox/polyline'

/**
 * Decode a Google Encoded Polyline string into an array of [lat, lng] pairs.
 *
 * @param encoded - The encoded polyline string from Strava's `summary_polyline`
 * @returns Array of [latitude, longitude] pairs
 */
export function decodePolyline(encoded: string): [number, number][] {
  if (!encoded) return []
  // @mapbox/polyline.decode returns [[lat, lng], ...] which is exactly what we want
  return polyline.decode(encoded) as [number, number][]
}
