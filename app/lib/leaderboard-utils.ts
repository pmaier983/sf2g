/**
 * Leaderboard display helpers.
 *
 * Pure functions for formatting and calculating leaderboard values.
 * Extracted for testability — all defensive against undefined/null/NaN.
 */
import { METERS_PER_MILE, METERS_TO_FEET, MPS_TO_MPH } from './constants'
import { msToMph } from './wind'
import type { UnitSystem } from '../components/UnitToggle'

/**
 * Safely coerce a possibly-undefined/null value to a number.
 * Returns 0 for undefined, null, NaN, and non-finite values.
 */
export function safeNumber(value: unknown): number {
  if (value === undefined || value === null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Meters → miles (localized string with no decimal places) */
export function formatMiles(meters: unknown): string {
  const m = safeNumber(meters)
  const miles = m / METERS_PER_MILE
  return `${miles.toLocaleString(undefined, { maximumFractionDigits: 0 })} mi`
}

/** Meters → feet (localized string with no decimal places) */
export function formatFeet(meters: unknown): string {
  const m = safeNumber(meters)
  const feet = m * METERS_TO_FEET
  return `${feet.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft`
}

/** Meters/second → miles/hour (1 decimal place) */
export function formatMph(mps: unknown): string {
  const m = safeNumber(mps)
  const mph = m * MPS_TO_MPH
  return `${mph.toFixed(1)} mph`
}

/**
 * Compute the SF2G share percentage.
 * Returns 0 if totalValue is 0, undefined, or produces NaN.
 */
export function sf2gSharePct(sf2gValue: unknown, totalValue: unknown): number {
  const sf2g = safeNumber(sf2gValue)
  const total = safeNumber(totalValue)
  if (total === 0) return 0
  return Math.min((sf2g / total) * 100, 100)
}

/**
 * Format a date string to 'Month Day, Year'.
 * Returns null for falsy/invalid inputs.
 */
export function formatRideDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Seconds → human-readable "Xh Ym" or "Ym" string */
export function formatMovingTime(seconds: number | null | undefined): string {
  const s = safeNumber(seconds)
  if (s === 0) return '—'
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ---------------------------------------------------------------------------
// Unit-aware formatters
// ---------------------------------------------------------------------------

/** Meters → display distance in the given unit system (0 decimal places) */
export function formatDistance(meters: unknown, unit: UnitSystem): string {
  const m = safeNumber(meters)
  if (unit === 'km') {
    const km = m / 1000
    return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
  }
  const miles = m / METERS_PER_MILE
  return `${miles.toLocaleString(undefined, { maximumFractionDigits: 0 })} mi`
}

/** Meters → display elevation in the given unit system (0 decimal places) */
export function formatElevation(meters: unknown, unit: UnitSystem): string {
  const m = safeNumber(meters)
  if (unit === 'km') {
    return `${m.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`
  }
  const feet = m * METERS_TO_FEET
  return `${feet.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft`
}

/** m/s → display speed in the given unit system (1 decimal place) */
export function formatSpeed(mps: unknown, unit: UnitSystem): string {
  const m = safeNumber(mps)
  if (unit === 'km') {
    const kmh = m * 3.6
    return `${kmh.toFixed(1)} km/h`
  }
  const mph = m * MPS_TO_MPH
  return `${mph.toFixed(1)} mph`
}

/** Format tailwind m/s as mph with sign and 1 decimal */
export function formatTailwind(ms: number | null | undefined): string {
  if (ms == null) return '0.0'
  const mph = msToMph(ms)
  const sign = mph > 0 ? '+' : ''
  return `${sign}${mph.toFixed(1)}`
}
