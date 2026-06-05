/**
 * Tests for cron job materialized view refreshes.
 *
 * These tests verify that the cron job refreshes ALL materialized views.
 * Bug prevented: PPR dawn rides MV was not refreshed in cron, causing
 * the PPR filter to show stale data (no rides from the current week).
 *
 * Strategy: Read the cron source file and verify that every known MV
 * refresh RPC call is present. This catches "forgot to add refresh" bugs.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// All materialized views that need periodic refreshing
const REQUIRED_MV_REFRESHES = [
  'refresh_ppr_dawn_rides',
  'refresh_ride_co_occurrences',
]

describe('cron job MV refreshes', () => {
  const cronSource = readFileSync(
    resolve(__dirname, '../cron.ts'),
    'utf-8',
  )

  const syncSource = readFileSync(
    resolve(__dirname, '../sync.ts'),
    'utf-8',
  )

  // The cron job OR the per-user sync should call each MV refresh
  const combinedSource = cronSource + syncSource

  for (const rpcName of REQUIRED_MV_REFRESHES) {
    it(`refreshes ${rpcName} in cron or sync`, () => {
      expect(
        combinedSource.includes(rpcName),
      ).toBe(true)
    })
  }

  it('cron refreshes ppr_dawn_rides (regression: PPR filter showed stale data)', () => {
    // Specifically verify cron.ts has PPR refresh — this was the missing piece
    expect(cronSource).toContain('refresh_ppr_dawn_rides')
  })

  it('sync refreshes ppr_dawn_rides after individual user sync', () => {
    expect(syncSource).toContain('refresh_ppr_dawn_rides')
  })
})
