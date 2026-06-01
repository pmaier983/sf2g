/**
 * Ride reclassification server function.
 *
 * Re-runs the route classifier and destination classifier on ALL rides
 * in the database using the stored polyline/coordinate/elevation data,
 * then batch-updates the classification columns and refreshes the
 * leaderboard materialized views.
 *
 * Performance optimizations:
 * - Selects only the columns needed for classification (no strava_raw)
 * - Uses a PostgreSQL RPC for bulk updates (1 call per batch, not 1 per ride)
 * - Refreshes materialized views in parallel
 */
import { createServerFn } from '@tanstack/react-start'
import { createServiceClient } from '../lib/supabase'
import { classifyRoute } from '../lib/route-classifier'
import { classifyDestination } from '../lib/destination-classifier'
import type { RouteCategory, ClassificationMethod, DestinationCompany } from '../lib/database.types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReclassifyResult {
  totalRides: number
  updated: number
  routeChanges: number
  destinationChanges: number
  errors: string[]
  breakdown: Record<string, number>
  durationMs: number
  /** Debug: sample of first few rides and their classification for diagnostics */
  debug?: Array<{
    name: string | null
    id: string
    hasPolyline: boolean
    polylineLen: number
    startLatlng: [number, number] | null
    endLatlng: [number, number] | null
    distance: number | null
    elevation: number | null
    oldCategory: string | null
    newCategory: string | null
    method: string
    confidence: number
  }>
}

/** Minimal ride shape for classification — avoids fetching strava_raw etc. */
interface ClassifiableRide {
  id: string
  summary_polyline: string | null
  distance_meters: number | null
  elevation_gain_meters: number | null
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
  route_category: RouteCategory | null
  classification_confidence: number | null
  classification_method: ClassificationMethod | null
  destination_company: DestinationCompany | null
  destination_office: string | null
  destination_distance_meters: number | null
}

/** Shape sent to the batch_update_ride_classifications RPC */
interface BatchUpdateEntry {
  id: string
  /** route_category (empty string = null for non-SF2G rides) */
  rc: string
  /** classification_confidence */
  cc: number
  /** classification_method */
  cm: string
  /** destination_company (empty string = null) */
  dc: string
  /** destination_office (empty string = null) */
  do: string
  /** destination_distance_meters (null if no match) */
  dd: number | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Columns selected — excludes strava_raw and other unneeded data */
const CLASSIFICATION_COLUMNS = [
  'id',
  'name',
  'summary_polyline',
  'distance_meters',
  'elevation_gain_meters',
  'start_latlng',
  'end_latlng',
  'route_category',
  'classification_confidence',
  'classification_method',
  'destination_company',
  'destination_office',
  'destination_distance_meters',
].join(',')

/** Batch size for reading rides from the database */
const READ_BATCH_SIZE = 1000

/** Batch size for writing updates via RPC (JSON payload limit) */
const WRITE_BATCH_SIZE = 500

// ---------------------------------------------------------------------------
// Core Reclassification Logic
// ---------------------------------------------------------------------------

/**
 * Reclassify a single ride. Returns a BatchUpdateEntry if anything
 * changed, or null if the classification is unchanged.
 */
function reclassifyRide(
  ride: ClassifiableRide,
): { entry: BatchUpdateEntry; routeChanged: boolean; destChanged: boolean } | null {
  // Re-run route classification
  const routeResult = classifyRoute({
    summary_polyline: ride.summary_polyline,
    distance: ride.distance_meters,
    total_elevation_gain: ride.elevation_gain_meters,
    start_latlng: ride.start_latlng,
    end_latlng: ride.end_latlng,
  })

  // Re-run destination classification
  const destResult = classifyDestination({
    end_latlng: ride.end_latlng,
    summary_polyline: ride.summary_polyline,
  })

  const newCompany = destResult?.company ?? null
  const newOffice = destResult?.officeName ?? null
  const newDistance = destResult?.distanceMeters ?? null

  // Check if anything changed
  const routeChanged =
    routeResult.category !== ride.route_category ||
    routeResult.confidence !== ride.classification_confidence ||
    routeResult.method !== ride.classification_method

  const destChanged =
    newCompany !== ride.destination_company ||
    newOffice !== ride.destination_office ||
    newDistance !== ride.destination_distance_meters

  if (!routeChanged && !destChanged) return null

  return {
    entry: {
      id: ride.id,
      rc: routeResult.category ?? '',
      cc: routeResult.confidence,
      cm: routeResult.method,
      dc: newCompany ?? '',
      do: newOffice ?? '',
      dd: newDistance,
    },
    routeChanged,
    destChanged,
  }
}

/**
 * Reclassify all rides in the database.
 *
 * 1. Paginate through rides (selecting only classification-relevant columns)
 * 2. Re-run classifiers on each ride in memory
 * 3. Batch-update changed rides via PostgreSQL RPC (single call per batch)
 * 4. Refresh leaderboard materialized views in parallel
 */
export async function performReclassification(): Promise<ReclassifyResult> {
  const startTime = Date.now()
  const supabase = createServiceClient()
  const errors: string[] = []
  let totalRides = 0
  let updated = 0
  let routeChanges = 0
  let destinationChanges = 0
  const breakdown: Record<string, number> = {}
  const debugSamples: ReclassifyResult['debug'] = []

  // Paginate through all rides
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data: rides, error: readError } = await supabase
      .from('rides')
      .select(CLASSIFICATION_COLUMNS)
      .order('created_at', { ascending: true })
      .range(offset, offset + READ_BATCH_SIZE - 1)

    if (readError) {
      errors.push(`Failed to read rides at offset ${offset}: ${readError.message}`)
      break
    }

    if (!rides || rides.length === 0) {
      hasMore = false
      break
    }

    totalRides += rides.length

    // Classify all rides in this page (pure CPU, very fast)
    const batchUpdates: BatchUpdateEntry[] = []

    for (const ride of rides as unknown as ClassifiableRide[]) {
      try {
        // Classify the ride
        const routeResult = classifyRoute({
          summary_polyline: ride.summary_polyline,
          distance: ride.distance_meters,
          total_elevation_gain: ride.elevation_gain_meters,
          start_latlng: ride.start_latlng,
          end_latlng: ride.end_latlng,
        })

        // Capture debug sample for the first 10 rides
        if (debugSamples!.length < 10) {
          debugSamples!.push({
            name: (ride as any).name ?? null,
            id: ride.id,
            hasPolyline: !!ride.summary_polyline,
            polylineLen: ride.summary_polyline?.length ?? 0,
            startLatlng: ride.start_latlng,
            endLatlng: ride.end_latlng,
            distance: ride.distance_meters,
            elevation: ride.elevation_gain_meters,
            oldCategory: ride.route_category,
            newCategory: routeResult.category,
            method: routeResult.method,
            confidence: routeResult.confidence,
          })
        }

        const result = reclassifyRide(ride)
        if (result) {
          batchUpdates.push(result.entry)

          if (result.routeChanged) routeChanges++
          if (result.destChanged) destinationChanges++

          // Track category transitions
          const oldCat = ride.route_category ?? 'null'
          const newCat = result.entry.rc || 'null'
          if (oldCat !== newCat) {
            const key = `${oldCat} → ${newCat}`
            breakdown[key] = (breakdown[key] ?? 0) + 1
          }
        }
      } catch (err) {
        errors.push(
          `Failed to reclassify ride ${ride.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Batch update via RPC (single HTTP call per WRITE_BATCH_SIZE chunk)
    for (let i = 0; i < batchUpdates.length; i += WRITE_BATCH_SIZE) {
      const batch = batchUpdates.slice(i, i + WRITE_BATCH_SIZE)

      try {
        const { data: affectedCount, error: rpcError } = await supabase
          .rpc('batch_update_ride_classifications', {
            updates: batch,
          })

        if (rpcError) {
          errors.push(`Batch update RPC error (offset ${offset}, chunk ${i}): ${rpcError.message}`)
        } else {
          updated += (affectedCount as number) ?? batch.length
        }
      } catch (err) {
        errors.push(
          `Batch update exception (offset ${offset}): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Check if we got a full page (might have more)
    if (rides.length < READ_BATCH_SIZE) {
      hasMore = false
    } else {
      offset += READ_BATCH_SIZE
    }
  }

  // Refresh both materialized views in parallel
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

  return {
    totalRides,
    updated,
    routeChanges,
    destinationChanges,
    errors,
    breakdown,
    durationMs: Date.now() - startTime,
    debug: debugSamples,
  }
}

// ---------------------------------------------------------------------------
// Server Function
// ---------------------------------------------------------------------------

/**
 * Trigger a full reclassification of all rides.
 * This is a dev-only operation — recalculates derived data
 * from existing stored ride data.
 *
 * TODO(security): In production, gate this behind an admin role check.
 */
export const triggerReclassify = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ReclassifyResult> => {
    return performReclassification()
  },
)
