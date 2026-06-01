/**
 * Tests for wind calculation utilities.
 *
 * Covers:
 * - Bearing calculation (Haversine) for real SF2G routes
 * - Tailwind/crosswind decomposition with meteorological convention
 * - m/s → mph conversion
 * - Wind effect classification thresholds
 */
import { describe, it, expect } from 'vitest'
import {
  calculateBearing,
  calculateWindComponents,
  msToMph,
  classifyWindEffect,
} from '../wind'

// ---------------------------------------------------------------------------
// Known coordinates for SF2G testing
// ---------------------------------------------------------------------------
const SF: [number, number] = [37.7749, -122.4194] // San Francisco
const GOOGLE: [number, number] = [37.4220, -122.0841] // Googleplex, Mountain View

// ---------------------------------------------------------------------------
// calculateBearing — bearing from start to end
// ---------------------------------------------------------------------------

describe('calculateBearing', () => {
  it('computes SF → Google bearing (~145° SSE)', () => {
    const bearing = calculateBearing(SF, GOOGLE)
    // SF to Google is roughly south-southeast
    expect(bearing).toBeGreaterThan(135)
    expect(bearing).toBeLessThan(155)
  })

  it('computes Google → SF bearing (~325° NNW)', () => {
    const bearing = calculateBearing(GOOGLE, SF)
    // Google to SF is roughly north-northwest
    expect(bearing).toBeGreaterThan(315)
    expect(bearing).toBeLessThan(335)
  })

  it('returns 0 for same point (degenerate case)', () => {
    const bearing = calculateBearing(SF, SF)
    // atan2(0, 0) = 0, so bearing should be 0
    expect(bearing).toBe(0)
  })

  it('computes east-west bearing (~90° or ~270°)', () => {
    const west: [number, number] = [37.7749, -122.5]
    const east: [number, number] = [37.7749, -122.3]
    const bearing = calculateBearing(west, east)
    // Should be approximately 90° (east)
    expect(bearing).toBeGreaterThan(85)
    expect(bearing).toBeLessThan(95)
  })

  it('computes north-south bearing (~180°)', () => {
    const north: [number, number] = [38.0, -122.4]
    const south: [number, number] = [37.5, -122.4]
    const bearing = calculateBearing(north, south)
    // Should be approximately 180° (due south)
    expect(bearing).toBeGreaterThan(175)
    expect(bearing).toBeLessThan(185)
  })

  it('always returns value between 0 and 360', () => {
    const pairs: Array<[[number, number], [number, number]]> = [
      [SF, GOOGLE],
      [GOOGLE, SF],
      [[0, 0], [1, 1]],
      [[0, 0], [-1, -1]],
      [[90, 0], [-90, 0]],
    ]
    for (const [start, end] of pairs) {
      const bearing = calculateBearing(start, end)
      expect(bearing).toBeGreaterThanOrEqual(0)
      expect(bearing).toBeLessThan(360)
    }
  })
})

// ---------------------------------------------------------------------------
// calculateWindComponents — tailwind/crosswind decomposition
// ---------------------------------------------------------------------------

describe('calculateWindComponents', () => {
  it('NNW wind + SSE ride = strong tailwind', () => {
    // Wind coming FROM ~330° (NNW), rider going ~145° (SSE)
    // Wind is going TO ~150°, almost aligned with rider → strong tailwind
    const { tailwind, crosswind } = calculateWindComponents(5, 330, 145)
    expect(tailwind).toBeGreaterThan(4) // Strong tailwind
    expect(Math.abs(crosswind)).toBeLessThan(2) // Small crosswind
  })

  it('NNW wind + NNW ride = strong headwind', () => {
    // Wind coming FROM ~330° (NNW), rider going ~325° (NNW)
    // Wind goes TO ~150°, opposite to rider → strong headwind
    const { tailwind, crosswind } = calculateWindComponents(5, 330, 325)
    expect(tailwind).toBeLessThan(-4) // Strong headwind
    expect(Math.abs(crosswind)).toBeLessThan(2) // Small crosswind
  })

  it('perpendicular wind = pure crosswind', () => {
    // Wind coming FROM 0° (north), rider going 90° (east)
    // Wind goes TO 180° (south), perpendicular to eastbound rider
    const { tailwind, crosswind } = calculateWindComponents(5, 0, 90)
    expect(Math.abs(tailwind)).toBeLessThan(0.01) // No tailwind component
    expect(Math.abs(crosswind)).toBeCloseTo(5, 0) // Full crosswind
  })

  it('direct tailwind (wind from behind)', () => {
    // Wind coming FROM 0° (north), rider going 180° (south)
    // Wind goes TO 180°, perfectly aligned → full tailwind
    const { tailwind } = calculateWindComponents(10, 0, 180)
    expect(tailwind).toBeCloseTo(10, 1)
  })

  it('direct headwind (wind from ahead)', () => {
    // Wind coming FROM 180° (south), rider going 180° (south)
    // Wind goes TO 0°, directly opposing → full headwind
    const { tailwind } = calculateWindComponents(10, 180, 180)
    expect(tailwind).toBeCloseTo(-10, 1)
  })

  it('zero wind speed produces zero components', () => {
    const { tailwind, crosswind } = calculateWindComponents(0, 330, 145)
    expect(tailwind).toBe(0)
    expect(crosswind).toBe(0)
  })

  it('symmetric: opposite ride direction reverses tailwind sign', () => {
    const sfToGoogle = calculateWindComponents(5, 330, 145)
    const googleToSf = calculateWindComponents(5, 330, 325)
    // Tailwind should flip sign (approximately)
    expect(sfToGoogle.tailwind).toBeGreaterThan(0)
    expect(googleToSf.tailwind).toBeLessThan(0)
    expect(Math.abs(sfToGoogle.tailwind + googleToSf.tailwind)).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// msToMph — unit conversion
// ---------------------------------------------------------------------------

describe('msToMph', () => {
  it('converts 1 m/s to ~2.237 mph', () => {
    expect(msToMph(1)).toBeCloseTo(2.23694, 4)
  })

  it('converts 0 m/s to 0 mph', () => {
    expect(msToMph(0)).toBe(0)
  })

  it('converts negative values (headwind)', () => {
    expect(msToMph(-5)).toBeCloseTo(-11.1847, 3)
  })

  it('converts typical wind speed (~4.5 m/s = ~10 mph)', () => {
    expect(msToMph(4.5)).toBeCloseTo(10.066, 2)
  })
})

// ---------------------------------------------------------------------------
// classifyWindEffect — UI classification
// ---------------------------------------------------------------------------

describe('classifyWindEffect', () => {
  it('classifies strong tailwind (> 3 m/s)', () => {
    expect(classifyWindEffect(4.5)).toBe('strong-tailwind')
    expect(classifyWindEffect(3.1)).toBe('strong-tailwind')
  })

  it('classifies light tailwind (> 1 m/s, ≤ 3 m/s)', () => {
    expect(classifyWindEffect(2.0)).toBe('light-tailwind')
    expect(classifyWindEffect(1.5)).toBe('light-tailwind')
  })

  it('classifies calm (absolute value ≤ 1 m/s)', () => {
    expect(classifyWindEffect(0.5)).toBe('calm')
    expect(classifyWindEffect(0)).toBe('calm')
    expect(classifyWindEffect(-0.5)).toBe('calm')
  })

  it('classifies light headwind (< -1 m/s, ≥ -3 m/s)', () => {
    expect(classifyWindEffect(-1.5)).toBe('light-headwind')
    expect(classifyWindEffect(-2.5)).toBe('light-headwind')
  })

  it('classifies strong headwind (< -3 m/s)', () => {
    expect(classifyWindEffect(-4.0)).toBe('strong-headwind')
    expect(classifyWindEffect(-10)).toBe('strong-headwind')
  })

  it('boundary: exactly 3 m/s is light-tailwind', () => {
    expect(classifyWindEffect(3)).toBe('light-tailwind')
  })

  it('boundary: exactly 1 m/s is calm', () => {
    expect(classifyWindEffect(1)).toBe('calm')
  })

  it('boundary: exactly -1 m/s is light-headwind (exclusive boundary)', () => {
    // > -1 is false for -1, so it falls to light-headwind
    expect(classifyWindEffect(-1)).toBe('light-headwind')
  })

  it('boundary: exactly -3 m/s is strong-headwind (exclusive boundary)', () => {
    // > -3 is false for -3, so it falls to strong-headwind
    expect(classifyWindEffect(-3)).toBe('strong-headwind')
  })
})
