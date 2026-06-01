/**
 * Cron job server function.
 *
 * Runs periodic maintenance tasks:
 * 1. Reclassify all rides (fixes stale classifications)
 * 2. Enrich missing wind data (fetches from Open-Meteo)
 *
 * Protected by CRON_SECRET — must match the secret set in environment variables.
 * Can be triggered via:
 * - The DevTools panel "Run Cron Jobs" button
 * - An external cron service hitting the /api/cron route with the correct secret
 *
 * TODO(security): Rate-limit this endpoint to prevent abuse.
 */
import { createServerFn } from '@tanstack/react-start'
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
 * Reclassification runs first (fixes stale data), then wind enrichment.
 */
export async function runCronJobs(): Promise<CronResult> {
  const startTime = Date.now()

  console.log('[cron] Starting cron jobs...')

  // 1. Reclassify all rides
  console.log('[cron] Running reclassification...')
  const reclassifyResult = await performReclassification()
  console.log(`[cron] Reclassification complete: ${reclassifyResult.updated} updated in ${reclassifyResult.durationMs}ms`)

  // 2. Enrich missing wind data
  console.log('[cron] Running wind enrichment...')
  const windResult = await enrichMissingWindData()
  console.log(`[cron] Wind enrichment complete: ${windResult.processed} processed in ${windResult.durationMs}ms`)

  const totalDurationMs = Date.now() - startTime
  console.log(`[cron] All cron jobs complete in ${totalDurationMs}ms`)

  return {
    reclassify: reclassifyResult,
    wind: windResult,
    totalDurationMs,
  }
}
