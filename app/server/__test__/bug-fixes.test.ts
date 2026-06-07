/**
 * Regression tests for bug fixes (June 2026 batch).
 *
 * Bugs prevented:
 * 1. "Reverse" label should say "Only Reverse"
 * 2. "Weekends" label should say "Exclude Weekends" + inverted visual
 * 3. Disconnect Strava dialog should list detailed consequences
 * 4. Years badge should show unfiltered active_years (not filtered by route/date)
 * 5. "Other" route selected → empty Riders table (sf2g_total excludes 'other')
 * 6. All-Time table + company filter (verified working, structural test)
 * 7. PPR @ 6am + specific route → empty table (double-filtering by route)
 *
 * Strategy: Static analysis of source files to verify structural invariants.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Bug 1: "Reverse" → "Only Reverse"
// ---------------------------------------------------------------------------

describe('Bug 1: Reverse label renamed to Only Reverse', () => {
  const filterChipsSource = readFileSync(
    resolve(__dirname, '../../components/FilterChips.tsx'),
    'utf-8',
  )

  it('chip label says "Only Reverse" not just "Reverse"', () => {
    expect(filterChipsSource).toContain('Only Reverse')
  })

  it('does not have a standalone "Reverse" label (excluding "Only Reverse")', () => {
    // Remove all instances of "Only Reverse" and check there's no bare "Reverse" label
    const withoutOnlyReverse = filterChipsSource.replace(/Only Reverse/g, '')
    // The word "Reverse" should only appear in variable names, comments, or the tooltip
    // It should NOT appear as a standalone chip label text
    const chipLabelPattern = />\s*Reverse\s*</
    expect(chipLabelPattern.test(withoutOnlyReverse)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bug 2: "Weekends" → "Exclude Weekends" + inverted visual
// ---------------------------------------------------------------------------

describe('Bug 2: Weekends renamed to Exclude Weekends with inverted visual', () => {
  const filterChipsSource = readFileSync(
    resolve(__dirname, '../../components/FilterChips.tsx'),
    'utf-8',
  )

  it('chip label says "Exclude Weekends"', () => {
    expect(filterChipsSource).toContain('Exclude Weekends')
  })

  it('tooltip says "Exclude rides from Saturday and Sunday"', () => {
    expect(filterChipsSource).toContain('Exclude rides from Saturday and Sunday')
  })

  it('does NOT have old tooltip "Include rides from Saturday and Sunday"', () => {
    expect(filterChipsSource).not.toContain('Include rides from Saturday and Sunday')
  })

  it('visual state is inverted: chip selected when weekendsActive is false', () => {
    // The CSS class should use !weekendsActive for the selected state
    expect(filterChipsSource).toContain('!weekendsActive')
  })

  it('aria-label says "Exclude weekend rides"', () => {
    expect(filterChipsSource).toContain('Exclude weekend rides')
  })
})

// ---------------------------------------------------------------------------
// Bug 3: Disconnect Strava detailed consequences dialog
// ---------------------------------------------------------------------------

describe('Bug 3: Disconnect Strava dialog lists consequences', () => {
  const profileSource = readFileSync(
    resolve(__dirname, '../../routes/profile/$userId.tsx'),
    'utf-8',
  )

  it('mentions data deletion', () => {
    expect(profileSource).toContain('delete')
  })

  it('shows ride count in the warning', () => {
    // Should use totalRides to show how many rides will be deleted
    expect(profileSource).toContain('totalRides')
    expect(profileSource).toContain('rides) from SF2G')
  })

  it('mentions leaderboard impact', () => {
    expect(profileSource).toContain('leaderboard')
  })

  it('mentions reconnection is possible', () => {
    expect(profileSource).toContain('reconnect')
    expect(profileSource).toContain('re-synced from Strava')
  })

  it('uses a div (not p) for the warning container', () => {
    // Changed from <p> to <div> since we have block-level children
    expect(profileSource).toContain('<div className="profile-header__disconnect-warning">')
  })

  it('does NOT use window.confirm or window.alert', () => {
    expect(profileSource).not.toContain('window.confirm')
    expect(profileSource).not.toContain('window.alert')
    expect(profileSource).not.toContain('window.prompt')
  })
})

// ---------------------------------------------------------------------------
// Bug 4: Years badge shows unfiltered active_years
// ---------------------------------------------------------------------------

describe('Bug 4: Years badge always shows unfiltered active_years', () => {
  const leaderboardServerSource = readFileSync(
    resolve(__dirname, '../../server/leaderboard.ts'),
    'utf-8',
  )

  it('fetches unfiltered active_years from leaderboard_view', () => {
    expect(leaderboardServerSource).toContain('unfilteredYears')
    expect(leaderboardServerSource).toContain("from('leaderboard_view')")
    expect(leaderboardServerSource).toContain("select('user_id, active_years')")
  })

  it('builds unfilteredYearsMap for lookup', () => {
    expect(leaderboardServerSource).toContain('unfilteredYearsMap')
    expect(leaderboardServerSource).toContain('new Map')
  })

  it('uses unfilteredYearsMap.get(userId) for active_years', () => {
    expect(leaderboardServerSource).toContain('unfilteredYearsMap.get(userId)')
  })

  it('falls back to agg.years.size if materialized view lookup fails', () => {
    expect(leaderboardServerSource).toContain('unfilteredYearsMap.get(userId) ?? agg.years.size')
  })
})

// ---------------------------------------------------------------------------
// Bug 5: "Other" route selected shows riders with only 'other' rides
// ---------------------------------------------------------------------------

describe('Bug 5: Other route filter includes other_count in zero-ride check', () => {
  const leaderboardPageSource = readFileSync(
    resolve(__dirname, '../../routes/leaderboard.tsx'),
    'utf-8',
  )

  it('checks other_count when includeOther is true or routes includes other', () => {
    expect(leaderboardPageSource).toContain('includeOther')
    expect(leaderboardPageSource).toContain("routes.includes('other'")
    expect(leaderboardPageSource).toContain('other_count')
  })

  it('adds other_count to sf2g_total for the zero-ride filter', () => {
    expect(leaderboardPageSource).toContain('(entry.sf2g_total ?? 0) + (entry.other_count ?? 0)')
  })

  it('includeOther is in the filteredData dependency array', () => {
    // The useMemo dependency array must include includeOther
    const depsMatch = leaderboardPageSource.match(/\[leaderboardData,\s*routes,\s*includeOther/)
    expect(depsMatch).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Bug 6: All-Time table + company filter (verified working, structural test)
// ---------------------------------------------------------------------------

describe('Bug 6: All-Time view respects company filter end-to-end', () => {
  const allTimeParamsSource = readFileSync(
    resolve(__dirname, '../../queries/alltime.ts'),
    'utf-8',
  )

  const allTimeServerSource = readFileSync(
    resolve(__dirname, '../../server/alltime.ts'),
    'utf-8',
  )

  const leaderboardPageSource = readFileSync(
    resolve(__dirname, '../../routes/leaderboard.tsx'),
    'utf-8',
  )

  it('AllTimeParams includes company field', () => {
    expect(allTimeParamsSource).toContain('company?: string')
  })

  it('alltime server function applies company filter', () => {
    expect(allTimeServerSource).toContain('destination_company')
    expect(allTimeServerSource).toContain('data.company')
  })

  it('leaderboard page passes company to allTimeQueryOptions', () => {
    expect(leaderboardPageSource).toContain('company:')
    expect(leaderboardPageSource).toContain('allTimeQueryOptions')
  })
})

// ---------------------------------------------------------------------------
// Bug 7: PPR + route filter no longer double-filters
// ---------------------------------------------------------------------------

describe('Bug 7: PPR query does not filter by route categories', () => {
  const leaderboardPageSource = readFileSync(
    resolve(__dirname, '../../routes/leaderboard.tsx'),
    'utf-8',
  )

  it('pprDawnRiderIdsQueryOptions call does NOT include routeCategories', () => {
    // Find the pprDawnRiderIdsQueryOptions call and verify no routeCategories param
    const pprCallMatch = leaderboardPageSource.match(
      /pprDawnRiderIdsQueryOptions\(\{[\s\S]*?\}\)/,
    )
    expect(pprCallMatch).not.toBeNull()
    expect(pprCallMatch![0]).not.toContain('routeCategories')
  })

  it('PPR query only passes dateFrom and dateTo', () => {
    const pprCallMatch = leaderboardPageSource.match(
      /pprDawnRiderIdsQueryOptions\(\{[\s\S]*?\}\)/,
    )
    expect(pprCallMatch).not.toBeNull()
    expect(pprCallMatch![0]).toContain('dateFrom')
    expect(pprCallMatch![0]).toContain('dateTo')
  })
})
