/**
 * Wind calculation utilities for SF2G rides.
 *
 * Pure functions for computing ride bearing from GPS coordinates,
 * decomposing wind into tailwind/crosswind components, and
 * classifying wind effects for UI display.
 */

/**
 * Convert degrees to radians.
 */
function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Convert radians to degrees.
 */
function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

/**
 * Calculate bearing between two lat/lng points using the Haversine formula.
 * Returns degrees 0–360 (0 = north, 90 = east, 180 = south, 270 = west).
 *
 * @param start - [latitude, longitude] of start point
 * @param end - [latitude, longitude] of end point
 * @returns bearing in degrees (0–360)
 */
export function calculateBearing(
  start: [number, number],
  end: [number, number],
): number {
  const [lat1, lng1] = start
  const [lat2, lng2] = end

  const φ1 = toRadians(lat1)
  const φ2 = toRadians(lat2)
  const Δλ = toRadians(lng2 - lng1)

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

  const θ = Math.atan2(y, x)
  // Normalize to 0–360
  return ((toDegrees(θ) % 360) + 360) % 360
}

/**
 * Calculate tailwind and crosswind components given wind data and ride bearing.
 *
 * Wind direction uses meteorological convention: the direction wind is
 * coming FROM. To compute how much the wind helps/hinders the rider,
 * we add 180° to get the direction the wind is going TO, then project
 * onto the ride bearing.
 *
 * @param windSpeedMs - wind speed in m/s
 * @param windDirectionDeg - meteorological wind direction (where wind comes FROM), 0–360°
 * @param rideBearingDeg - direction of travel, 0–360°
 * @returns tailwind (positive = pushing rider) and crosswind (positive = from left) in m/s
 */
export function calculateWindComponents(
  windSpeedMs: number,
  windDirectionDeg: number,
  rideBearingDeg: number,
): { tailwind: number; crosswind: number } {
  // Wind is coming FROM windDirectionDeg, so it's going TO (windDirectionDeg + 180)
  const windGoingToDeg = windDirectionDeg + 180
  const angleDiffRad = toRadians(windGoingToDeg - rideBearingDeg)

  const tailwind = windSpeedMs * Math.cos(angleDiffRad)
  const crosswind = windSpeedMs * Math.sin(angleDiffRad)

  return { tailwind, crosswind }
}

/**
 * Convert meters per second to miles per hour.
 * 1 m/s = 2.23694 mph
 */
export function msToMph(ms: number): number {
  return ms * 2.23694
}

/**
 * Classify wind effect for UI display based on tailwind component.
 *
 * Thresholds:
 * - strong > 3 m/s
 * - light > 1 m/s
 * - calm ≤ 1 m/s (absolute value)
 */
export function classifyWindEffect(
  tailwindMs: number,
): 'strong-tailwind' | 'light-tailwind' | 'calm' | 'light-headwind' | 'strong-headwind' {
  if (tailwindMs > 3) return 'strong-tailwind'
  if (tailwindMs > 1) return 'light-tailwind'
  if (tailwindMs > -1) return 'calm'
  if (tailwindMs > -3) return 'light-headwind'
  return 'strong-headwind'
}
