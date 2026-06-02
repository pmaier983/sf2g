/**
 * Wind enrichment server function.
 *
 * Fetches historical wind data from Open-Meteo for rides that are missing
 * tailwind/crosswind data, computes wind components, and updates the database.
 *
 * Shared logic is used by both:
 * - The DevTools manual trigger (triggerWindEnrichment server function)
 * - The cron worker (future: scheduled trigger)
 *
 * Optimizations:
 * - Groups rides by date → one API call per unique date (not per ride)
 * - Fetches in batches of 200 for memory efficiency, loops until all done
 * - Safety valve at 5000 rides total to prevent infinite loops
 * - Refreshes leaderboard materialized views after updates
 */
import { createServerFn } from '@tanstack/react-start'
import { createServiceClient } from '../lib/supabase'
import { getSessionData } from '../lib/session'
import { fetchDailyWind, getWindAtHour } from './weather'
import { calculateBearing, calculateWindComponents } from '../lib/wind'
import { OPEN_METEO_RATE_LIMIT } from '../lib/constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindEnrichmentResult {
  processed: number
  totalMissing: number
  errors: string[]
  durationMs: number
}

/** Minimal ride shape for wind enrichment — only the columns we need */
interface EnrichableRide {
  id: string
  ride_date: string
  start_date: string
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rides to fetch per DB query (memory-efficient batching) */
const BATCH_SIZE = 200

/** Safety valve: max total rides to process in one invocation */
const MAX_TOTAL = 5000

/** Validate that a value is a valid [lat, lng] tuple with finite numbers */
function isValidLatLng(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  )
}

// ---------------------------------------------------------------------------
// Core Enrichment Logic
// ---------------------------------------------------------------------------

/**
 * Enrich rides that are missing wind data.
 *
 * 1. Query rides WHERE tailwind_component_ms IS NULL with valid coordinates
 * 2. Count total missing for progress display
 * 3. Group rides by ride_date for efficient API batching
 * 4. For each date group: fetch wind once, compute per-ride components
 * 5. Update each ride in Supabase
 * 6. Refresh leaderboard if any rides were processed
 */
export async function enrichMissingWindData(
  /** Max weather API calls to make (for cron budget control). Defaults to Open-Meteo cron budget. */
  maxApiCalls: number = OPEN_METEO_RATE_LIMIT.CRON_BUDGET,
): Promise<WindEnrichmentResult> {
  const startTime = Date.now()
  const supabase = createServiceClient()
  const errors: string[] = []
  let totalProcessed = 0
  let apiCallCount = 0

  // 1. Count total missing rides (for progress display)
  const { count: totalMissing, error: countError } = await supabase
    .from('rides')
    .select('id', { count: 'exact', head: true })
    .is('tailwind_component_ms', null)
    .not('start_latlng', 'is', null)
    .not('end_latlng', 'is', null)

  if (countError) {
    return {
      processed: 0,
      totalMissing: 0,
      errors: [`Failed to count missing rides: ${countError.message}`],
      durationMs: Date.now() - startTime,
    }
  }

  // 2. Loop through batches until all rides are enriched (or safety valve hit)
  while (totalProcessed < MAX_TOTAL) {
    // Fetch next batch of rides missing wind data
    const { data: rides, error: fetchError } = await supabase
      .from('rides')
      .select('id, ride_date, start_date, start_latlng, end_latlng')
      .is('tailwind_component_ms', null)
      .not('start_latlng', 'is', null)
      .not('end_latlng', 'is', null)
      .order('ride_date', { ascending: false })
      .limit(BATCH_SIZE)

    if (fetchError) {
      errors.push(`Failed to fetch rides: ${fetchError.message}`)
      break
    }

    if (!rides || rides.length === 0) break // All done!

    // 3. Group rides by ride_date for efficient API batching
    const ridesByDate = new Map<string, EnrichableRide[]>()

    for (const ride of rides as unknown as EnrichableRide[]) {
      const existing = ridesByDate.get(ride.ride_date)
      if (existing) {
        existing.push(ride)
      } else {
        ridesByDate.set(ride.ride_date, [ride])
      }
    }

    // 4. Process each date group
    let batchProcessed = 0
    let budgetExhausted = false

    for (const [date, dateRides] of ridesByDate) {
      // Check Open-Meteo rate limit budget
      if (apiCallCount >= maxApiCalls) {
        console.log(`[wind-enrichment] Open-Meteo budget exhausted (${apiCallCount}/${maxApiCalls} calls used), stopping`)
        budgetExhausted = true
        break
      }

      // Use the first ride's start coordinates for the weather API call
      const firstRide = dateRides[0]
      if (!firstRide.start_latlng) continue

      const [lat, lng] = firstRide.start_latlng

      // Rate limit: add a small delay between API calls to stay under 600/min
      if (apiCallCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }

      // Fetch wind data for this date (one API call per date)
      apiCallCount++
      const dailyWind = await fetchDailyWind(lat, lng, date)

      if (!dailyWind) {
        errors.push(`Failed to fetch wind data for ${date}`)
        continue
      }

      // Process each ride in this date group
      for (const ride of dateRides) {
        try {
          if (!isValidLatLng(ride.start_latlng) || !isValidLatLng(ride.end_latlng)) continue

          // Extract the hour in Pacific time (Open-Meteo data uses America/Los_Angeles)
          const rideHour = parseInt(
            new Date(ride.start_date).toLocaleString('en-US', {
              timeZone: 'America/Los_Angeles',
              hour: 'numeric',
              hour12: false,
            }),
            10,
          )

          // Get wind at the ride's start hour
          const hourlyWind = getWindAtHour(dailyWind, rideHour)
          if (!hourlyWind) {
            errors.push(`No wind data for ride ${ride.id} at hour ${rideHour}`)
            continue
          }

          // Calculate ride bearing from start to end coordinates
          const bearing = calculateBearing(ride.start_latlng, ride.end_latlng)

          // Calculate wind components
          const components = calculateWindComponents(
            hourlyWind.wind_speed_ms,
            hourlyWind.wind_direction_deg,
            bearing,
          )

          // Guard against non-finite wind values
          if (!Number.isFinite(components.tailwind) || !Number.isFinite(components.crosswind)) {
            errors.push(`Non-finite wind values for ride ${ride.id}`)
            continue
          }

          // 5. Update the ride in Supabase
          const { error: updateError } = await supabase
            .from('rides')
            .update({
              wind_speed_ms: hourlyWind.wind_speed_ms,
              wind_direction_deg: hourlyWind.wind_direction_deg,
              wind_gust_ms: hourlyWind.wind_gust_ms,
              ride_bearing_deg: bearing,
              tailwind_component_ms: components.tailwind,
              crosswind_component_ms: components.crosswind,
              wind_data_source: 'open-meteo',
            })
            .eq('id', ride.id)

          if (updateError) {
            errors.push(`Failed to update ride ${ride.id}: ${updateError.message}`)
          } else {
            batchProcessed++
          }
        } catch (err) {
          errors.push(
            `Error processing ride ${ride.id}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    totalProcessed += batchProcessed
    console.log(`[wind-enrichment] Batch done: ${batchProcessed} processed, ${totalProcessed} total so far, ${apiCallCount} API calls used`)

    if (budgetExhausted) break
  }

  // 6. Refresh leaderboard if any rides were processed
  if (totalProcessed > 0) {
    const [leaderboardResult, companyResult] = await Promise.allSettled([
      supabase.rpc('refresh_leaderboard'),
      supabase.rpc('refresh_company_leaderboard'),
    ])

    if (leaderboardResult.status === 'rejected') {
      errors.push(`Failed to refresh leaderboard: ${leaderboardResult.reason}`)
    }
    if (companyResult.status === 'rejected') {
      errors.push(`Failed to refresh company leaderboard: ${companyResult.reason}`)
    }
  }

  return {
    processed: totalProcessed,
    totalMissing: totalMissing ?? 0,
    errors,
    durationMs: Date.now() - startTime,
  }
}

// ---------------------------------------------------------------------------
// Server Function
// ---------------------------------------------------------------------------

/**
 * Trigger wind enrichment for rides missing wind data.
 * Called from the DevTools panel button or from the cron worker.
 */
export const triggerWindEnrichment = createServerFn({ method: 'POST' }).handler(
  async (): Promise<WindEnrichmentResult> => {
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    return enrichMissingWindData()
  },
)
