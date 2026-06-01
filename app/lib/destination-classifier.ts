/**
 * Destination classifier — identifies which company a ride ended near.
 *
 * Uses the ride's `end_latlng` (or the last point of the decoded polyline)
 * to check proximity to known Bay Area tech office locations.
 *
 * Returns the closest matching company if the endpoint is within
 * DESTINATION_RADIUS_METERS (800m) of any office, or null if no match.
 */

import { decodePolyline } from './polyline'
import {
  OFFICE_LOCATIONS,
  DESTINATION_RADIUS_METERS,
  type DestinationCompany,
  type OfficeLocation,
} from './office-locations'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DestinationResult {
  /** Which company the ride ended near */
  company: DestinationCompany
  /** Name of the specific office matched */
  officeName: string
  /** City of the matched office */
  city: string
  /** Distance in meters from ride endpoint to office */
  distanceMeters: number
}

export interface DestinationClassifiableActivity {
  /** End coordinates [lat, lng] from Strava */
  end_latlng?: [number, number] | null
  /** Google encoded polyline string — used as fallback if end_latlng is missing */
  summary_polyline?: string | null
}

// ---------------------------------------------------------------------------
// Haversine distance (duplicated from route-classifier to avoid coupling)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000

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
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Get the ride's endpoint coordinates.
 *
 * Prefers `end_latlng` from Strava. Falls back to the last decoded
 * polyline point if `end_latlng` is missing.
 */
function getEndpoint(
  activity: DestinationClassifiableActivity,
): [number, number] | null {
  // Prefer explicit end coordinates
  if (activity.end_latlng && activity.end_latlng.length === 2) {
    const [lat, lng] = activity.end_latlng
    if (typeof lat === 'number' && typeof lng === 'number') {
      return [lat, lng]
    }
  }

  // Fallback: last point of decoded polyline
  if (activity.summary_polyline) {
    const points = decodePolyline(activity.summary_polyline)
    if (points.length > 0) {
      return points[points.length - 1]
    }
  }

  return null
}

/**
 * Find the closest office to a given coordinate, if within the radius.
 */
function findClosestOffice(
  lat: number,
  lng: number,
  offices: OfficeLocation[],
  radiusMeters: number,
): { office: OfficeLocation; distance: number } | null {
  let closest: { office: OfficeLocation; distance: number } | null = null

  for (const office of offices) {
    const distance = haversineDistance(lat, lng, office.lat, office.lng)

    if (distance <= radiusMeters) {
      if (!closest || distance < closest.distance) {
        closest = { office, distance }
      }
    }
  }

  return closest
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Classify which tech company a ride ended near.
 *
 * Checks the ride's endpoint against all known Bay Area tech office
 * locations (Netflix, Google, Apple, Meta, Nvidia). Both active and
 * closed offices are checked — commutes to past offices still count.
 *
 * @returns The matching company and office details, or `null` if the
 *          ride didn't end near any known office.
 */
export function classifyDestination(
  activity: DestinationClassifiableActivity,
): DestinationResult | null {
  const endpoint = getEndpoint(activity)
  if (!endpoint) return null

  const [lat, lng] = endpoint

  const match = findClosestOffice(lat, lng, OFFICE_LOCATIONS, DESTINATION_RADIUS_METERS)
  if (!match) return null

  return {
    company: match.office.company,
    officeName: match.office.name,
    city: match.office.city,
    distanceMeters: Math.round(match.distance),
  }
}

/**
 * Classify destination for all provided companies, or filter to a specific set.
 *
 * Useful for checking only certain companies (e.g. if a user selects
 * which company they work at).
 */
export function classifyDestinationForCompanies(
  activity: DestinationClassifiableActivity,
  companies: DestinationCompany[],
): DestinationResult | null {
  const endpoint = getEndpoint(activity)
  if (!endpoint) return null

  const [lat, lng] = endpoint

  const filteredOffices = OFFICE_LOCATIONS.filter((o) =>
    companies.includes(o.company),
  )

  const match = findClosestOffice(lat, lng, filteredOffices, DESTINATION_RADIUS_METERS)
  if (!match) return null

  return {
    company: match.office.company,
    officeName: match.office.name,
    city: match.office.city,
    distanceMeters: Math.round(match.distance),
  }
}
