/**
 * Destination classifier — identifies which company a ride started or ended near.
 *
 * Uses the ride's `end_latlng` first (normal commute: SF → Peninsula),
 * then falls back to `start_latlng` (reverse commute: Peninsula → SF)
 * to check proximity to known Bay Area tech office locations.
 *
 * Returns the closest matching company if either endpoint is within
 * DESTINATION_RADIUS_METERS (1000m default, per-office overrides) of any office, or null if no match.
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
  /** Start coordinates [lat, lng] from Strava — used for reverse commute detection */
  start_latlng?: [number, number] | null
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
 * Get the ride's startpoint coordinates.
 *
 * Uses `start_latlng` from Strava. Falls back to the first decoded
 * polyline point if `start_latlng` is missing.
 */
function getStartpoint(
  activity: DestinationClassifiableActivity,
): [number, number] | null {
  // Prefer explicit start coordinates
  if (activity.start_latlng && activity.start_latlng.length === 2) {
    const [lat, lng] = activity.start_latlng
    if (typeof lat === 'number' && typeof lng === 'number') {
      return [lat, lng]
    }
  }

  // Fallback: first point of decoded polyline
  if (activity.summary_polyline) {
    const points = decodePolyline(activity.summary_polyline)
    if (points.length > 0) {
      return points[0]
    }
  }

  return null
}

/**
 * Find the closest office to a given coordinate, if within that office's radius.
 * Uses office.radiusMeters if set, otherwise falls back to defaultRadius.
 */
function findClosestOffice(
  lat: number,
  lng: number,
  offices: OfficeLocation[],
  defaultRadius: number,
): { office: OfficeLocation; distance: number } | null {
  let closest: { office: OfficeLocation; distance: number } | null = null

  for (const office of offices) {
    const radius = office.radiusMeters ?? defaultRadius
    const distance = haversineDistance(lat, lng, office.lat, office.lng)

    if (distance <= radius) {
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
 * Classify which tech company a ride started or ended near.
 *
 * Checks the ride's endpoint first (normal commute: SF → Peninsula),
 * then the startpoint (reverse commute: Peninsula → SF) against all
 * known Bay Area tech office locations (Netflix, Google, Apple, Meta,
 * Nvidia). Both active and closed offices are checked — commutes to
 * past offices still count.
 *
 * @returns The matching company and office details, or `null` if the
 *          ride didn't start or end near any known office.
 */
export function classifyDestination(
  activity: DestinationClassifiableActivity,
): DestinationResult | null {
  // Try endpoint first (normal commute: SF → Peninsula)
  const endpoint = getEndpoint(activity)
  if (endpoint) {
    const [lat, lng] = endpoint
    const match = findClosestOffice(lat, lng, OFFICE_LOCATIONS, DESTINATION_RADIUS_METERS)
    if (match) {
      return {
        company: match.office.company,
        officeName: match.office.name,
        city: match.office.city,
        distanceMeters: Math.round(match.distance),
      }
    }
  }

  // Try startpoint (reverse commute: Peninsula → SF)
  const startpoint = getStartpoint(activity)
  if (startpoint) {
    const [lat, lng] = startpoint
    const match = findClosestOffice(lat, lng, OFFICE_LOCATIONS, DESTINATION_RADIUS_METERS)
    if (match) {
      return {
        company: match.office.company,
        officeName: match.office.name,
        city: match.office.city,
        distanceMeters: Math.round(match.distance),
      }
    }
  }

  return null
}

/**
 * Classify destination for all provided companies, or filter to a specific set.
 *
 * Checks endpoint first (normal commute), then startpoint (reverse commute).
 * Useful for checking only certain companies (e.g. if a user selects
 * which company they work at).
 */
export function classifyDestinationForCompanies(
  activity: DestinationClassifiableActivity,
  companies: DestinationCompany[],
): DestinationResult | null {
  const filteredOffices = OFFICE_LOCATIONS.filter((o) =>
    companies.includes(o.company),
  )

  // Try endpoint first (normal commute: SF → Peninsula)
  const endpoint = getEndpoint(activity)
  if (endpoint) {
    const [lat, lng] = endpoint
    const match = findClosestOffice(lat, lng, filteredOffices, DESTINATION_RADIUS_METERS)
    if (match) {
      return {
        company: match.office.company,
        officeName: match.office.name,
        city: match.office.city,
        distanceMeters: Math.round(match.distance),
      }
    }
  }

  // Try startpoint (reverse commute: Peninsula → SF)
  const startpoint = getStartpoint(activity)
  if (startpoint) {
    const [lat, lng] = startpoint
    const match = findClosestOffice(lat, lng, filteredOffices, DESTINATION_RADIUS_METERS)
    if (match) {
      return {
        company: match.office.company,
        officeName: match.office.name,
        city: match.office.city,
        distanceMeters: Math.round(match.distance),
      }
    }
  }

  return null
}
