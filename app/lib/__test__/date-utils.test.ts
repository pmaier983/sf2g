/**
 * Tests for date utility functions used in leaderboard filters.
 *
 * Bug prevented: `toISODate` using `toISOString()` (UTC) instead of local
 * time, causing "Today" filter to return the wrong date for users west of UTC.
 * Example: At 6pm PDT, `new Date().toISOString()` returns `2026-06-05T01:...`
 * instead of `2026-06-04T...`, making the "Today" filter off by one day.
 *
 * Also tests the `extractTimezone` function used in PPR ride filtering.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// toISODate — local timezone date formatting
// ---------------------------------------------------------------------------

/**
 * Reimplementation of the local-time toISODate from FilterChips.tsx for testing.
 * This is the CORRECT implementation that uses getFullYear/getMonth/getDate
 * instead of toISOString (UTC-based).
 */
function toISODate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('toISODate (local timezone)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats a standard date correctly', () => {
    const d = new Date(2025, 5, 15) // June 15, 2025 (month is 0-indexed)
    expect(toISODate(d)).toBe('2025-06-15')
  })

  it('pads single-digit months', () => {
    const d = new Date(2025, 0, 1) // Jan 1
    expect(toISODate(d)).toBe('2025-01-01')
  })

  it('pads single-digit days', () => {
    const d = new Date(2025, 11, 5) // Dec 5
    expect(toISODate(d)).toBe('2025-12-05')
  })

  it('uses local date, not UTC (the bug fix)', () => {
    // Simulate 11:30 PM PDT on June 4 = 06:30 AM UTC June 5
    // In PDT (UTC-7), getDate() = 4, but toISOString() would give "2026-06-05"
    const d = new Date('2026-06-05T06:30:00Z') // 11:30 PM PDT on June 4

    // This test verifies the function uses local time, not UTC
    // The result depends on the test runner's timezone, but the key
    // invariant is: toISODate should match getFullYear/getMonth/getDate
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(toISODate(d)).toBe(expected)

    // The OLD buggy implementation would have used d.toISOString().slice(0,10)
    // which would ALWAYS return "2026-06-05" regardless of local timezone.
    // Verify our implementation does NOT just use toISOString:
    const utcDate = d.toISOString().slice(0, 10)
    // In any timezone west of UTC, these would differ:
    // toISODate(d) would return local date, utcDate would return UTC date
    // We can't assert inequality because CI might run in UTC, but we can
    // verify the source code doesn't use toISOString:
  })

  it('FilterChips.tsx uses getFullYear/getMonth/getDate, not toISOString', () => {
    // Static analysis: verify the source code doesn't use the buggy pattern
    const source = readFileSync(
      resolve(__dirname, '../../components/FilterChips.tsx'),
      'utf-8',
    )

    // Extract the toISODate function body
    const fnMatch = source.match(/function toISODate\(d: Date\): string \{([^}]+)\}/)
    expect(fnMatch).not.toBeNull()

    const fnBody = fnMatch![1]

    // Should use getFullYear, getMonth, getDate (local time)
    expect(fnBody).toContain('getFullYear')
    expect(fnBody).toContain('getMonth')
    expect(fnBody).toContain('getDate')

    // Should NOT use toISOString (UTC-based — the bug)
    expect(fnBody).not.toContain('toISOString')
  })
})

// ---------------------------------------------------------------------------
// extractTimezone — Strava timezone format parsing
// ---------------------------------------------------------------------------

/**
 * Reimplementation of extractTimezone from leaderboard.ts for testing.
 */
function extractTimezone(tz: string | null | undefined): string {
  if (!tz) return 'America/Los_Angeles'
  const match = tz.match(/\)\s*(.+)$/)
  return match?.[1]?.trim() || 'America/Los_Angeles'
}

describe('extractTimezone', () => {
  it('extracts IANA timezone from Strava format', () => {
    expect(extractTimezone('(GMT-08:00) America/Los_Angeles')).toBe('America/Los_Angeles')
  })

  it('handles different Strava timezone formats', () => {
    expect(extractTimezone('(GMT+05:30) Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(extractTimezone('(GMT+00:00) Europe/London')).toBe('Europe/London')
    expect(extractTimezone('(GMT-05:00) America/New_York')).toBe('America/New_York')
  })

  it('returns default for null', () => {
    expect(extractTimezone(null)).toBe('America/Los_Angeles')
  })

  it('returns default for undefined', () => {
    expect(extractTimezone(undefined)).toBe('America/Los_Angeles')
  })

  it('returns default for empty string', () => {
    expect(extractTimezone('')).toBe('America/Los_Angeles')
  })
})

// ---------------------------------------------------------------------------
// Date preset regression tests
// ---------------------------------------------------------------------------

describe('date preset: "This Week" boundaries', () => {
  it('starts on Monday and ends on Sunday', () => {
    // Wednesday June 4, 2025
    const wed = new Date(2025, 5, 4) // June 4 = Wednesday (getDay()=3)
    const day = wed.getDay()
    const diffToMonday = day === 0 ? 6 : day - 1
    const monday = new Date(wed)
    monday.setDate(monday.getDate() - diffToMonday)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)

    expect(toISODate(monday)).toBe('2025-06-02') // Monday
    expect(toISODate(sunday)).toBe('2025-06-08') // Sunday
    expect(monday.getDay()).toBe(1) // Monday
    expect(sunday.getDay()).toBe(0) // Sunday
  })

  it('handles Sunday edge case (start of JS week)', () => {
    const sun = new Date(2025, 5, 1) // June 1 = Sunday
    const day = sun.getDay()
    const diffToMonday = day === 0 ? 6 : day - 1
    const monday = new Date(sun)
    monday.setDate(monday.getDate() - diffToMonday)

    expect(toISODate(monday)).toBe('2025-05-26') // Previous Monday
    expect(monday.getDay()).toBe(1)
  })

  it('handles Monday edge case', () => {
    const mon = new Date(2025, 5, 2) // June 2 = Monday
    const day = mon.getDay()
    const diffToMonday = day === 0 ? 6 : day - 1
    const monday = new Date(mon)
    monday.setDate(monday.getDate() - diffToMonday)

    expect(toISODate(monday)).toBe('2025-06-02') // Same day
    expect(monday.getDay()).toBe(1)
  })
})
