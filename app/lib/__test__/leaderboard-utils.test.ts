/**
 * Tests for leaderboard display utilities.
 *
 * Covers:
 * - Defensive handling of undefined/null/NaN (the NaN bug)
 * - Unit conversion accuracy (meters→miles, meters→feet, mps→mph)
 * - SF2G share percentage calculation
 * - Date formatting edge cases
 */
import { describe, it, expect } from 'vitest'
import {
  safeNumber,
  formatMiles,
  formatFeet,
  formatMph,
  sf2gSharePct,
  formatRideDate,
} from '../leaderboard-utils'

// ---------------------------------------------------------------------------
// safeNumber — defensive number coercion
// ---------------------------------------------------------------------------

describe('safeNumber', () => {
  it('returns the number for valid numbers', () => {
    expect(safeNumber(42)).toBe(42)
    expect(safeNumber(3.14)).toBe(3.14)
    expect(safeNumber(0)).toBe(0)
    expect(safeNumber(-10)).toBe(-10)
  })

  it('returns 0 for undefined', () => {
    expect(safeNumber(undefined)).toBe(0)
  })

  it('returns 0 for null', () => {
    expect(safeNumber(null)).toBe(0)
  })

  it('returns 0 for NaN', () => {
    expect(safeNumber(NaN)).toBe(0)
  })

  it('returns 0 for Infinity', () => {
    expect(safeNumber(Infinity)).toBe(0)
    expect(safeNumber(-Infinity)).toBe(0)
  })

  it('coerces numeric strings to numbers', () => {
    expect(safeNumber('42')).toBe(42)
    expect(safeNumber('3.14')).toBe(3.14)
  })

  it('returns 0 for non-numeric strings', () => {
    expect(safeNumber('abc')).toBe(0)
    expect(safeNumber('')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// formatMiles — meters to miles display
// ---------------------------------------------------------------------------

describe('formatMiles', () => {
  it('converts meters to miles correctly', () => {
    // 1609.34 meters = 1 mile
    expect(formatMiles(1609.34)).toBe('1 mi')
  })

  it('formats larger distances', () => {
    // ~100 miles ≈ 160934 meters
    const result = formatMiles(160934)
    expect(result).toBe('100 mi')
  })

  it('returns "0 mi" for zero', () => {
    expect(formatMiles(0)).toBe('0 mi')
  })

  it('returns "0 mi" for undefined (NaN bug fix)', () => {
    expect(formatMiles(undefined)).toBe('0 mi')
  })

  it('returns "0 mi" for null (NaN bug fix)', () => {
    expect(formatMiles(null)).toBe('0 mi')
  })

  it('returns "0 mi" for NaN (NaN bug fix)', () => {
    expect(formatMiles(NaN)).toBe('0 mi')
  })

  it('converts a typical SF2G distance (~65km) correctly', () => {
    // ~65km = 65000m ≈ 40.4 miles
    const result = formatMiles(65000)
    expect(result).toMatch(/^40 mi$/)
  })
})

// ---------------------------------------------------------------------------
// formatFeet — meters to feet display
// ---------------------------------------------------------------------------

describe('formatFeet', () => {
  it('converts meters to feet correctly', () => {
    // 1 meter = 3.281 feet
    expect(formatFeet(1)).toBe('3 ft')
  })

  it('formats typical SF2G elevation', () => {
    // ~700m elevation ≈ 2297 feet
    const result = formatFeet(700)
    expect(result).toBe('2,297 ft')
  })

  it('returns "0 ft" for zero', () => {
    expect(formatFeet(0)).toBe('0 ft')
  })

  it('returns "0 ft" for undefined (NaN bug fix)', () => {
    expect(formatFeet(undefined)).toBe('0 ft')
  })

  it('returns "0 ft" for null (NaN bug fix)', () => {
    expect(formatFeet(null)).toBe('0 ft')
  })

  it('returns "0 ft" for NaN (NaN bug fix)', () => {
    expect(formatFeet(NaN)).toBe('0 ft')
  })
})

// ---------------------------------------------------------------------------
// formatMph — meters/sec to mph
// ---------------------------------------------------------------------------

describe('formatMph', () => {
  it('converts mps to mph correctly', () => {
    // 1 m/s = 2.23694 mph
    expect(formatMph(1)).toBe('2.2 mph')
  })

  it('converts typical cycling speed', () => {
    // ~8 m/s = ~17.9 mph (solid commute pace)
    expect(formatMph(8)).toBe('17.9 mph')
  })

  it('returns "0.0 mph" for zero', () => {
    expect(formatMph(0)).toBe('0.0 mph')
  })

  it('returns "0.0 mph" for undefined (NaN bug fix)', () => {
    expect(formatMph(undefined)).toBe('0.0 mph')
  })

  it('returns "0.0 mph" for null (NaN bug fix)', () => {
    expect(formatMph(null)).toBe('0.0 mph')
  })

  it('returns "0.0 mph" for NaN (NaN bug fix)', () => {
    expect(formatMph(NaN)).toBe('0.0 mph')
  })
})

// ---------------------------------------------------------------------------
// sf2gSharePct — percentage calculation
// ---------------------------------------------------------------------------

describe('sf2gSharePct', () => {
  it('calculates 100% when sf2g equals total', () => {
    expect(sf2gSharePct(1000, 1000)).toBe(100)
  })

  it('calculates 50% correctly', () => {
    expect(sf2gSharePct(500, 1000)).toBe(50)
  })

  it('calculates typical share correctly', () => {
    // 65000m SF2G out of 80000m total = 81.25%
    expect(sf2gSharePct(65000, 80000)).toBe(81.25)
  })

  it('caps at 100% if sf2g exceeds total (data inconsistency)', () => {
    expect(sf2gSharePct(1200, 1000)).toBe(100)
  })

  it('returns 0% when total is zero', () => {
    expect(sf2gSharePct(500, 0)).toBe(0)
  })

  it('returns 0% when both are zero', () => {
    expect(sf2gSharePct(0, 0)).toBe(0)
  })

  it('returns 0% when sf2gValue is undefined (NaN bug fix)', () => {
    expect(sf2gSharePct(undefined, 1000)).toBe(0)
  })

  it('returns 0% when totalValue is undefined (NaN bug fix)', () => {
    expect(sf2gSharePct(1000, undefined)).toBe(0)
  })

  it('returns 0% when both are undefined (NaN bug fix)', () => {
    expect(sf2gSharePct(undefined, undefined)).toBe(0)
  })

  it('returns 0% when sf2gValue is null (NaN bug fix)', () => {
    expect(sf2gSharePct(null, 1000)).toBe(0)
  })

  it('returns 0% when totalValue is null (NaN bug fix)', () => {
    expect(sf2gSharePct(1000, null)).toBe(0)
  })

  it('returns 0% when sf2gValue is NaN (NaN bug fix)', () => {
    expect(sf2gSharePct(NaN, 1000)).toBe(0)
  })

  it('returns 0% when totalValue is NaN (NaN bug fix)', () => {
    expect(sf2gSharePct(1000, NaN)).toBe(0)
  })

  it('never returns NaN regardless of input', () => {
    const edgeCases = [undefined, null, NaN, Infinity, -Infinity, 0, '', 'abc']
    for (const a of edgeCases) {
      for (const b of edgeCases) {
        const result = sf2gSharePct(a, b)
        expect(Number.isNaN(result)).toBe(false)
        expect(Number.isFinite(result)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// formatRideDate — date formatting
// ---------------------------------------------------------------------------

describe('formatRideDate', () => {
  it('formats a valid ISO date', () => {
    // Use a full datetime to avoid UTC midnight → local day shift
    const result = formatRideDate('2025-06-15T12:00:00Z')
    expect(result).toBe('Jun 15, 2025')
  })

  it('formats a datetime string', () => {
    const result = formatRideDate('2025-03-01T08:30:00Z')
    expect(result).toContain('2025')
    expect(result).toContain('Mar')
  })

  it('returns null for null input', () => {
    expect(formatRideDate(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(formatRideDate(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(formatRideDate('')).toBeNull()
  })

  it('returns null for invalid date string', () => {
    expect(formatRideDate('not-a-date')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration: simulating real leaderboard row data
// ---------------------------------------------------------------------------

describe('leaderboard row simulation', () => {
  it('handles a row where sf2g columns exist (post-migration)', () => {
    const row = {
      total_distance_meters: 160934,   // ~100 miles total
      sf2g_distance_meters: 120700,    // ~75 miles SF2G
      total_elevation_meters: 5000,    // ~16,405 ft total
      sf2g_elevation_meters: 4000,     // ~13,124 ft SF2G
    }

    expect(formatMiles(row.sf2g_distance_meters)).toBe('75 mi')
    expect(formatFeet(row.sf2g_elevation_meters)).toBe('13,124 ft')
    expect(sf2gSharePct(row.sf2g_distance_meters, row.total_distance_meters)).toBeCloseTo(75, 0)
    expect(sf2gSharePct(row.sf2g_elevation_meters, row.total_elevation_meters)).toBe(80)
  })

  it('handles a row where sf2g columns are undefined (pre-migration)', () => {
    // Simulates what Supabase returns when the view lacks sf2g columns
    const row = {
      total_distance_meters: 160934,
      sf2g_distance_meters: undefined as unknown as number,
      total_elevation_meters: 5000,
      sf2g_elevation_meters: undefined as unknown as number,
    }

    // Should NOT produce NaN — should gracefully show 0
    const distPct = sf2gSharePct(row.sf2g_distance_meters, row.total_distance_meters)
    const elevPct = sf2gSharePct(row.sf2g_elevation_meters, row.total_elevation_meters)
    const distDisplay = formatMiles(row.sf2g_distance_meters)
    const elevDisplay = formatFeet(row.sf2g_elevation_meters)

    expect(Number.isNaN(distPct)).toBe(false)
    expect(Number.isNaN(elevPct)).toBe(false)
    expect(distPct).toBe(0)
    expect(elevPct).toBe(0)
    expect(distDisplay).toBe('0 mi')
    expect(elevDisplay).toBe('0 ft')
  })

  it('handles a row where sf2g columns are null (DB null)', () => {
    const row = {
      total_distance_meters: 160934,
      sf2g_distance_meters: null as unknown as number,
      total_elevation_meters: 5000,
      sf2g_elevation_meters: null as unknown as number,
    }

    expect(sf2gSharePct(row.sf2g_distance_meters, row.total_distance_meters)).toBe(0)
    expect(formatMiles(row.sf2g_distance_meters)).toBe('0 mi')
    expect(formatFeet(row.sf2g_elevation_meters)).toBe('0 ft')
  })

  it('handles a rider with 100% SF2G riding', () => {
    const row = {
      total_distance_meters: 65000,
      sf2g_distance_meters: 65000,
      total_elevation_meters: 700,
      sf2g_elevation_meters: 700,
    }

    expect(sf2gSharePct(row.sf2g_distance_meters, row.total_distance_meters)).toBe(100)
    expect(sf2gSharePct(row.sf2g_elevation_meters, row.total_elevation_meters)).toBe(100)
  })

  it('handles a rider with no rides (all zeros)', () => {
    const row = {
      total_distance_meters: 0,
      sf2g_distance_meters: 0,
      total_elevation_meters: 0,
      sf2g_elevation_meters: 0,
    }

    expect(sf2gSharePct(row.sf2g_distance_meters, row.total_distance_meters)).toBe(0)
    expect(formatMiles(row.sf2g_distance_meters)).toBe('0 mi')
    expect(formatFeet(row.sf2g_elevation_meters)).toBe('0 ft')
  })
})

