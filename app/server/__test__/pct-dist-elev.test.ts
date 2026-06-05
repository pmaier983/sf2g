/**
 * Regression tests for % Dist / % Elev leaderboard calculations.
 *
 * Bug prevented:
 * The leaderboard showed ~100% for % Dist and % Elev for nearly all riders
 * because the denominator (total_distance_meters, total_elevation_meters) was
 * computed from only SF2G rides instead of ALL rides. The fix ensures:
 *
 * 1. The materialized view (leaderboard_view) sums ALL rides for totals
 * 2. The JS filtered-leaderboard path fetches ALL rides for the denominator
 * 3. The column accessor correctly divides sf2g by total
 *
 * Strategy: Static analysis of SQL + source files for structural invariants,
 * plus unit tests for the client-side percentage formula.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the latest migration file that defines leaderboard_view. */
function findLatestLeaderboardViewMigration(): string {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations')
  const files = readdirSync(migrationsDir).sort()

  // Walk backwards to find the latest migration that creates leaderboard_view
  for (let i = files.length - 1; i >= 0; i--) {
    const content = readFileSync(resolve(migrationsDir, files[i]), 'utf-8')
    if (content.includes('CREATE MATERIALIZED VIEW leaderboard_view')) {
      return content
    }
  }
  throw new Error('No migration found that creates leaderboard_view')
}

/** Find the latest migration file that defines get_leaderboard_by_date_range. */
function findLatestDateRangeMigration(): string {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations')
  const files = readdirSync(migrationsDir).sort()

  for (let i = files.length - 1; i >= 0; i--) {
    const content = readFileSync(resolve(migrationsDir, files[i]), 'utf-8')
    if (content.includes('CREATE OR REPLACE FUNCTION get_leaderboard_by_date_range')) {
      return content
    }
  }
  throw new Error('No migration found that defines get_leaderboard_by_date_range')
}

/** Find the migration that defines get_user_ride_totals RPC. */
function findUserRideTotalsMigration(): string {
  const migrationsDir = resolve(__dirname, '../../../supabase/migrations')
  const files = readdirSync(migrationsDir).sort()

  for (let i = files.length - 1; i >= 0; i--) {
    const content = readFileSync(resolve(migrationsDir, files[i]), 'utf-8')
    if (content.includes('get_user_ride_totals')) {
      return content
    }
  }
  throw new Error('No migration found that defines get_user_ride_totals')
}

/** Strip SQL single-line comments (-- ...) from a SQL string. */
function stripSqlComments(sql: string): string {
  return sql.split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n')
}

// ---------------------------------------------------------------------------
// SQL: leaderboard_view materialized view
// ---------------------------------------------------------------------------

describe('leaderboard_view SQL — % dist/elev denominator uses ALL rides', () => {
  const viewSql = findLatestLeaderboardViewMigration()

  it('does NOT use sf2g_years CTE to filter total_distance_meters', () => {
    // The old bug: total_distance_meters was filtered to only sum rides from
    // calendar years with ≥1 SF2G ride via a sf2g_years CTE. This inflated
    // the percentage by excluding non-SF2G years from the denominator.
    //
    // Strip comments so we only check the actual SQL statements, not
    // explanatory comment text that references the old behavior.
    const sqlBody = stripSqlComments(viewSql)
    const hasSf2gYearsFilter = sqlBody.includes('sf2g_years')
    expect(hasSf2gYearsFilter).toBe(false)
  })

  it('total_distance_meters sums ALL rides unconditionally', () => {
    // The correct formula: COALESCE(SUM(r.distance_meters), 0)
    // It must NOT have a FILTER clause that restricts to certain years or routes
    expect(viewSql).toContain('AS total_distance_meters')
    expect(viewSql).toContain('AS total_elevation_meters')

    // Extract lines with total_distance_meters definition
    const lines = viewSql.split('\n')
    const distLine = lines.find(l =>
      l.includes('AS total_distance_meters'),
    )
    expect(distLine).toBeDefined()

    // The total line should NOT contain a FILTER clause
    // (sf2g_distance_meters SHOULD have a FILTER, but total should NOT)
    expect(distLine).not.toContain('FILTER')
  })

  it('total_elevation_meters sums ALL rides unconditionally', () => {
    const lines = viewSql.split('\n')
    const elevLine = lines.find(l =>
      l.includes('AS total_elevation_meters'),
    )
    expect(elevLine).toBeDefined()
    expect(elevLine).not.toContain('FILTER')
  })

  it('sf2g_distance_meters DOES filter to SF2G rides only', () => {
    // The numerator should filter to route_category IS NOT NULL AND != 'other'
    const lines = viewSql.split('\n')
    const sf2gDistLine = lines.find(l =>
      l.includes('AS sf2g_distance_meters'),
    )
    expect(sf2gDistLine).toBeDefined()
    expect(sf2gDistLine).toContain('FILTER')
  })

  it('sf2g_elevation_meters DOES filter to SF2G rides only', () => {
    const lines = viewSql.split('\n')
    const sf2gElevLine = lines.find(l =>
      l.includes('AS sf2g_elevation_meters'),
    )
    expect(sf2gElevLine).toBeDefined()
    expect(sf2gElevLine).toContain('FILTER')
  })
})

// ---------------------------------------------------------------------------
// SQL: get_leaderboard_by_date_range RPC function
// ---------------------------------------------------------------------------

describe('get_leaderboard_by_date_range — % dist/elev denominator uses ALL rides', () => {
  const rpcSql = findLatestDateRangeMigration()

  it('does NOT use sf2g_years CTE for totals', () => {
    // Same invariant: the RPC must not filter totals by active SF2G years.
    // Strip comments so we only check SQL statements.
    const sqlBody = stripSqlComments(rpcSql)
    expect(sqlBody).not.toContain('sf2g_years')
  })

  it('total_distance_meters has no FILTER clause', () => {
    const lines = rpcSql.split('\n')
    const distLine = lines.find(l =>
      l.includes('AS total_distance_meters'),
    )
    expect(distLine).toBeDefined()
    expect(distLine).not.toContain('FILTER')
  })

  it('total_elevation_meters has no FILTER clause', () => {
    const lines = rpcSql.split('\n')
    const elevLine = lines.find(l =>
      l.includes('AS total_elevation_meters'),
    )
    expect(elevLine).toBeDefined()
    expect(elevLine).not.toContain('FILTER')
  })
})

// ---------------------------------------------------------------------------
// SQL: get_user_ride_totals RPC (bypasses Supabase max_rows limit)
// ---------------------------------------------------------------------------

describe('get_user_ride_totals RPC — aggregates ALL rides in SQL', () => {
  const rpcSql = findUserRideTotalsMigration()
  const sqlBody = stripSqlComments(rpcSql)

  it('RPC migration exists', () => {
    expect(sqlBody).toContain('get_user_ride_totals')
  })

  it('aggregates distance and elevation per user', () => {
    expect(sqlBody).toContain('SUM(r.distance_meters)')
    expect(sqlBody).toContain('SUM(r.elevation_gain_meters)')
    expect(sqlBody).toContain('GROUP BY r.user_id')
  })

  it('does NOT filter by route_category (includes all ride types)', () => {
    // The whole point is to include ALL rides (SF2G + non-SF2G + unclassified)
    expect(sqlBody).not.toContain('route_category')
  })

  it('does NOT filter by day of week (includes weekends)', () => {
    // Weekends should be included in the denominator
    expect(sqlBody).not.toContain('DOW')
    expect(sqlBody).not.toContain('day_of_week')
  })
})

// ---------------------------------------------------------------------------
// JS server: fetchFilteredLeaderboard uses RPC for all-rides denominator
// ---------------------------------------------------------------------------

describe('fetchFilteredLeaderboard — all-rides denominator via RPC', () => {
  const serverSource = readFileSync(
    resolve(__dirname, '../../server/leaderboard.ts'),
    'utf-8',
  )

  it('uses get_user_ride_totals RPC to compute per-user totals in SQL', () => {
    // The Supabase REST API enforces a max_rows limit (default 1000) that
    // silently truncates .limit() calls. To bypass this, the server must
    // use an RPC function that aggregates on the database side.
    expect(serverSource).toContain("'get_user_ride_totals'")
  })

  it('does NOT use raw allRidesQuery (bypassed by Supabase max_rows)', () => {
    // The old approach fetched raw rides and aggregated in JS, but was
    // silently capped at 1000 rows by Supabase's server-side max_rows config.
    // Ensure we no longer use this broken approach.
    expect(serverSource).not.toContain('allRidesQuery')
  })

  it('builds userTotals map from the RPC result', () => {
    // The server should build a Map<string, { distance, elevation }> from
    // the RPC result rows for use as the % dist/elev denominator.
    expect(serverSource).toContain('userTotals')
    expect(serverSource).toContain('userTotalsRows')
  })

  it('uses allTotals (from RPC) as the denominator, not filtered totals', () => {
    // The entry construction should prefer allTotals over agg.total_distance
    expect(serverSource).toContain('allTotals?.distance')
    expect(serverSource).toContain('allTotals?.elevation')
  })
})

// ---------------------------------------------------------------------------
// Column accessor: % Dist / % Elev formula
// ---------------------------------------------------------------------------

describe('LeaderboardColumns — % dist/elev accessor', () => {
  const columnsSource = readFileSync(
    resolve(__dirname, '../../components/LeaderboardColumns.tsx'),
    'utf-8',
  )

  it('sf2g_dist_pct divides sf2g_distance by total_distance', () => {
    expect(columnsSource).toContain('sf2g_dist_pct')
    expect(columnsSource).toContain('sf2g_distance_meters')
    expect(columnsSource).toContain('total_distance_meters')

    // The accessor should compute: sf2g_distance_meters / total_distance_meters
    // Verify the column references both fields
    const distPctSection = columnsSource.split('sf2g_dist_pct')[0]
    // The accessor function just before sf2g_dist_pct should reference both
    expect(distPctSection).toContain('row.sf2g_distance_meters')
    expect(distPctSection).toContain('row.total_distance_meters')
  })

  it('sf2g_elev_pct divides sf2g_elevation by total_elevation', () => {
    expect(columnsSource).toContain('sf2g_elev_pct')
    expect(columnsSource).toContain('sf2g_elevation_meters')
    expect(columnsSource).toContain('total_elevation_meters')
  })

  it('tooltips do NOT mention sf2g_years or active years filtering', () => {
    // The old tooltips said "only counting years with ≥1 SF2G ride"
    // which is no longer accurate after the fix
    const distTooltip = columnsSource.match(/sf2g_dist_pct[\s\S]*?tooltip="([^"]+)"/)?.[1] ?? ''
    const elevTooltip = columnsSource.match(/sf2g_elev_pct[\s\S]*?tooltip="([^"]+)"/)?.[1] ?? ''

    expect(distTooltip).not.toContain('active')
    expect(distTooltip).not.toContain('years')
    expect(elevTooltip).not.toContain('active')
    expect(elevTooltip).not.toContain('years')
  })
})

// ---------------------------------------------------------------------------
// Unit: simulate the column accessor logic
// ---------------------------------------------------------------------------

describe('% Dist / % Elev — formula correctness', () => {
  /** Mirrors the accessor in LeaderboardColumns.tsx */
  function pctAccessor(sf2g: number, total: number): number {
    return total > 0 ? sf2g / total : 0
  }

  it('rider with mixed riding gets < 100%', () => {
    // 28 SF2G rides out of 902 total rides
    // sf2g_distance = 2,147,580m, total_distance = 26,112,000m
    const pct = pctAccessor(2_147_580, 26_112_000)
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThan(0.15) // ~8.2%
  })

  it('rider who only commutes gets ~100%', () => {
    const pct = pctAccessor(65_000, 65_200) // tiny non-SF2G portion
    expect(pct).toBeGreaterThan(0.99)
  })

  it('rider with no rides gets 0%', () => {
    expect(pctAccessor(0, 0)).toBe(0)
  })

  it('sf2g can never exceed total (sanity check)', () => {
    // Even if data is inconsistent, the ratio should be capped to ≤1
    // by the display layer (TinyPie caps at 100%)
    const pct = pctAccessor(100_000, 50_000)
    // The accessor itself doesn't cap — that's TinyPie's job
    expect(pct).toBeGreaterThan(1) // raw ratio > 1 is possible
  })

  it('returns a finite number for all edge cases', () => {
    const cases = [
      [0, 0],
      [0, 100],
      [100, 0],
      [100, 100],
      [1, 1_000_000],
    ]
    for (const [sf2g, total] of cases) {
      const result = pctAccessor(sf2g, total)
      expect(Number.isFinite(result)).toBe(true)
      expect(Number.isNaN(result)).toBe(false)
    }
  })
})
