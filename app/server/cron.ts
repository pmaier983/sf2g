/**
 * Cron job server function.
 *
 * Runs periodic maintenance tasks (NO Strava API polling):
 * 1. Reclassify all rides (fixes stale classifications)
 * 2. Enrich missing wind data (fetches from Open-Meteo)
 * 3. Refresh materialized views (co-occurrences, PPR dawn rides)
 *
 * All ride syncing is now webhook-driven (app/routes/api/webhook.ts).
 * This cron only handles local data maintenance that doesn't involve Strava.
 *
 * Rate limit budgets:
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
import { performReclassification, type ReclassifyResult } from './reclassify'
import { enrichMissingWindData, type WindEnrichmentResult } from './wind-enrichment'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronResult {
  reclassify: ReclassifyResult
  wind: WindEnrichmentResult
  totalDurationMs: number
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
 * These are local data maintenance tasks only — no Strava API calls.
 * All ride syncing is handled by webhooks (app/server/webhook.ts).
 *
 * Order matters:
 * 1. Reclassify rides (fixes classifications when gateway logic changes)
 * 2. Wind enrichment (fetches weather data from Open-Meteo for new rides)
 * 3. Refresh materialized views (co-occurrences, PPR dawn rides)
 */
export async function runCronJobs(): Promise<CronResult> {
  const startTime = Date.now()

  console.log('[cron] Starting maintenance jobs...')

  // 1. Reclassify all rides (may fail on free plan if subrequests exhausted)
  let reclassifyResult: ReclassifyResult
  try {
    console.log('[cron] Running reclassification...')
    reclassifyResult = await performReclassification()
    console.log(`[cron] Reclassification complete: ${reclassifyResult.updated} updated in ${reclassifyResult.durationMs}ms`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[cron] Reclassification failed (may be subrequest limit): ${msg}`)
    reclassifyResult = {
      totalRides: 0, updated: 0, routeChanges: 0, destinationChanges: 0,
      errors: [`Skipped: ${msg}`], breakdown: {}, durationMs: 0,
    }
  }

  // 2. Enrich missing wind data (may fail on free plan if subrequests exhausted)
  let windResult: WindEnrichmentResult
  try {
    console.log('[cron] Running wind enrichment...')
    windResult = await enrichMissingWindData()
    console.log(`[cron] Wind enrichment complete: ${windResult.processed} processed in ${windResult.durationMs}ms`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[cron] Wind enrichment failed (may be subrequest limit): ${msg}`)
    windResult = {
      processed: 0, totalMissing: 0,
      errors: [`Skipped: ${msg}`], durationMs: 0,
    }
  }

  // 3. Refresh ride co-occurrences MV for the rider network
  //    Runs after reclassify so updated classifications are included.
  //    Non-concurrent refresh (no unique index), but fast for small rider pools.
  try {
    console.log('[cron] Refreshing ride co-occurrences MV...')
    const coOccStart = Date.now()
    const supabase = createServiceClient()
    await supabase.rpc('refresh_ride_co_occurrences' as never)
    console.log(`[cron] Ride co-occurrences refresh complete in ${Date.now() - coOccStart}ms`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[cron] Ride co-occurrences refresh failed (non-critical): ${msg}`)
  }

  // 4. Refresh PPR dawn rides MV so the PPR @ 6am filter includes new rides
  try {
    console.log('[cron] Refreshing PPR dawn rides MV...')
    const pprStart = Date.now()
    const supabase = createServiceClient()
    await supabase.rpc('refresh_ppr_dawn_rides' as never)
    console.log(`[cron] PPR dawn rides refresh complete in ${Date.now() - pprStart}ms`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[cron] PPR dawn rides refresh failed (non-critical): ${msg}`)
  }

  const totalDurationMs = Date.now() - startTime
  console.log(`[cron] All maintenance jobs complete in ${Math.round(totalDurationMs / 1000)}s`)

  return {
    reclassify: reclassifyResult,
    wind: windResult,
    totalDurationMs,
  }
}

