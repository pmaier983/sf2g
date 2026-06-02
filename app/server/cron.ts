/**
 * Cron job server function.
 *
 * Runs periodic maintenance tasks:
 * 1. **Sync all users** — fetch new rides from Strava for every registered user
 * 2. Reclassify all rides (fixes stale classifications)
 * 3. Enrich missing wind data (fetches from Open-Meteo)
 *
 * Rate limit budgets:
 * - Strava: Uses ~50% of the 15-min window (85 of 170 effective requests),
 *   leaving the other half for manual user syncs.
 * - Open-Meteo: Uses 200 of 10,000 daily calls, leaving plenty for manual
 *   wind enrichment triggers and future growth.
 *
 * Protected by CRON_SECRET — must match the secret set in environment variables.
 * Can be triggered via:
 * - The DevTools panel "Run Cron Jobs" button
 * - An external cron service hitting the /api/cron route with the correct secret
 *
 * TODO(security): Rate-limit this endpoint to prevent abuse.
 */
import { createServerFn } from '@tanstack/react-start'
import { createServiceClient } from '../lib/supabase'
import { CRON_SYNC_BUDGET } from '../lib/constants'
import { performReclassification, type ReclassifyResult } from './reclassify'
import { enrichMissingWindData, type WindEnrichmentResult } from './wind-enrichment'
import { performSync, type SyncResult } from './sync'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserSyncResult {
  userId: string
  displayName: string | null
  result: SyncResult | null
  error: string | null
  skipped: boolean
}

export interface SyncAllUsersResult {
  totalUsers: number
  synced: number
  skipped: number
  failed: number
  results: UserSyncResult[]
  durationMs: number
}

export interface CronResult {
  syncAll: SyncAllUsersResult
  reclassify: ReclassifyResult
  wind: WindEnrichmentResult
  totalDurationMs: number
}

// ---------------------------------------------------------------------------
// Sync All Users
// ---------------------------------------------------------------------------

/**
 * Sync rides for all users with valid Strava tokens.
 *
 * Iterates through all registered users, refreshing tokens as needed and
 * fetching new activities from Strava. Respects rate limits by:
 * - Adding a delay between each user sync
 * - Tracking total API calls and stopping early if budget is exhausted
 * - Enforcing a max total duration to prevent runaway execution
 *
 * Errors are isolated per-user — one user's expired token won't stop others.
 */
async function syncAllUsers(): Promise<SyncAllUsersResult> {
  const startTime = Date.now()
  const supabase = createServiceClient()
  const results: UserSyncResult[] = []

  // Fetch all users with valid Strava refresh tokens
  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('id, display_name, strava_refresh_token, last_sync_at')
    .neq('strava_refresh_token', '')
    .order('last_sync_at', { ascending: true, nullsFirst: true }) // Sync least-recently-synced first

  if (fetchError || !users) {
    console.error('[cron-sync] Failed to fetch users:', fetchError?.message)
    return {
      totalUsers: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      results: [],
      durationMs: Date.now() - startTime,
    }
  }

  console.log(`[cron-sync] Found ${users.length} users with valid Strava tokens`)

  let synced = 0
  let skipped = 0
  let failed = 0
  let estimatedApiCalls = 0

  for (const user of users) {
    // Check time budget
    const elapsed = Date.now() - startTime
    if (elapsed >= CRON_SYNC_BUDGET.MAX_TOTAL_DURATION_MS) {
      console.warn(`[cron-sync] Time budget exhausted (${Math.round(elapsed / 1000)}s), stopping with ${users.length - results.length} users remaining`)
      // Mark remaining users as skipped
      for (let i = results.length; i < users.length; i++) {
        results.push({
          userId: users[i].id,
          displayName: users[i].display_name,
          result: null,
          error: null,
          skipped: true,
        })
        skipped++
      }
      break
    }

    // Check Strava API budget (each sync uses ~1-3 API calls for incremental sync)
    if (estimatedApiCalls >= CRON_SYNC_BUDGET.MAX_STRAVA_REQUESTS) {
      console.warn(`[cron-sync] Strava API budget exhausted (${estimatedApiCalls}/${CRON_SYNC_BUDGET.MAX_STRAVA_REQUESTS} calls), stopping with ${users.length - results.length} users remaining`)
      for (let i = results.length; i < users.length; i++) {
        results.push({
          userId: users[i].id,
          displayName: users[i].display_name,
          result: null,
          error: null,
          skipped: true,
        })
        skipped++
      }
      break
    }

    // Add delay between users to spread load
    if (results.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, CRON_SYNC_BUDGET.DELAY_BETWEEN_USERS_MS))
    }

    console.log(`[cron-sync] Syncing user ${user.display_name ?? user.id} (${results.length + 1}/${users.length})`)

    try {
      const syncResult = await performSync(user.id)

      results.push({
        userId: user.id,
        displayName: user.display_name,
        result: syncResult,
        error: null,
        skipped: false,
      })

      synced++
      // Estimate API calls: 1 base + 1 per page (most incremental syncs are 1 page)
      estimatedApiCalls += Math.max(1, Math.ceil(syncResult.totalProcessed / 200))

      console.log(`[cron-sync] ✅ ${user.display_name ?? user.id}: ${syncResult.newRides} new rides (${syncResult.totalProcessed} processed)`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      results.push({
        userId: user.id,
        displayName: user.display_name,
        result: null,
        error: errorMsg,
        skipped: false,
      })

      failed++
      // Even failed syncs cost API calls (at least the token refresh attempt)
      estimatedApiCalls += 1

      // Don't log full stack for expected errors (expired tokens, etc.)
      if (errorMsg.includes('REAUTH_REQUIRED') || errorMsg.includes('token refresh failed')) {
        console.warn(`[cron-sync] ⚠️ ${user.display_name ?? user.id}: Needs re-auth (skipping)`)
      } else {
        console.error(`[cron-sync] ❌ ${user.display_name ?? user.id}: ${errorMsg}`)
      }
    }
  }

  const durationMs = Date.now() - startTime
  console.log(`[cron-sync] Complete: ${synced} synced, ${failed} failed, ${skipped} skipped in ${Math.round(durationMs / 1000)}s (est. ${estimatedApiCalls} Strava API calls)`)

  return {
    totalUsers: users.length,
    synced,
    skipped,
    failed,
    results,
    durationMs,
  }
}

// ---------------------------------------------------------------------------
// Server Function (auth-gated, for DevTools panel)
// ---------------------------------------------------------------------------

/**
 * Trigger all cron jobs manually from the DevTools panel.
 * Requires an authenticated session (same as other DevTools actions).
 */
export const triggerCronJobs = createServerFn({ method: 'POST' })
  .handler(async (): Promise<CronResult> => {
    return runCronJobs()
  })

// ---------------------------------------------------------------------------
// Core Logic (exported for the API route)
// ---------------------------------------------------------------------------

/**
 * Run all cron maintenance tasks sequentially.
 *
 * Order matters:
 * 1. Sync all users (produces new rides)
 * 2. Reclassify rides (fixes classifications on new + old rides)
 * 3. Wind enrichment (fetches weather data for new rides)
 */
export async function runCronJobs(): Promise<CronResult> {
  const startTime = Date.now()

  console.log('[cron] Starting cron jobs...')

  // 1. Sync all users (fetch new rides from Strava)
  console.log('[cron] Running sync for all users...')
  const syncAllResult = await syncAllUsers()
  console.log(`[cron] Sync complete: ${syncAllResult.synced} users synced, ${syncAllResult.failed} failed in ${Math.round(syncAllResult.durationMs / 1000)}s`)

  // 2. Reclassify all rides
  console.log('[cron] Running reclassification...')
  const reclassifyResult = await performReclassification()
  console.log(`[cron] Reclassification complete: ${reclassifyResult.updated} updated in ${reclassifyResult.durationMs}ms`)

  // 3. Enrich missing wind data (budget-limited for Open-Meteo rate limits)
  console.log('[cron] Running wind enrichment...')
  const windResult = await enrichMissingWindData()
  console.log(`[cron] Wind enrichment complete: ${windResult.processed} processed in ${windResult.durationMs}ms`)

  const totalDurationMs = Date.now() - startTime
  console.log(`[cron] All cron jobs complete in ${Math.round(totalDurationMs / 1000)}s`)

  return {
    syncAll: syncAllResult,
    reclassify: reclassifyResult,
    wind: windResult,
    totalDurationMs,
  }
}
