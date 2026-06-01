/**
 * Fix ALL "other" rides — paginated to handle Supabase's 1000-row limit.
 * Run with: npx tsx app/scripts/fix-other-rides.ts
 */
import { readFileSync } from 'fs'

try {
  const envFile = readFileSync('.env.local', 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx)
      const val = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = val
    }
  }
} catch { /* */ }

import { createClient } from '@supabase/supabase-js'
import { classifyRoute } from '../lib/route-classifier'

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env vars'); process.exit(1) }

const supabase = createClient(url, key)

const PAGE_SIZE = 1000

async function main() {
  console.log('\n=== Fixing ALL "other" rides (paginated) ===\n')

  // Count total
  const { count: totalOther } = await supabase
    .from('rides')
    .select('*', { count: 'exact', head: true })
    .eq('route_category', 'other')

  console.log(`Total rides classified as "other": ${totalOther}\n`)

  let nullified = 0
  let keptOther = 0
  let reclassified = 0
  let errors = 0
  let offset = 0
  let processed = 0

  while (true) {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('id, name, ride_date, summary_polyline, distance_meters, elevation_gain_meters, start_latlng, end_latlng, route_category')
      .eq('route_category', 'other')
      .order('ride_date', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) { console.error('Fetch error:', error.message); return }
    if (!rides || rides.length === 0) break

    console.log(`Processing batch at offset ${offset}: ${rides.length} rides`)

    for (const ride of rides) {
      const result = classifyRoute({
        summary_polyline: ride.summary_polyline,
        distance: ride.distance_meters,
        total_elevation_gain: ride.elevation_gain_meters,
        start_latlng: ride.start_latlng as [number, number] | null,
        end_latlng: ride.end_latlng as [number, number] | null,
      })

      // If the result is the same as current, skip
      if (result.category === 'other') {
        keptOther++
        processed++
        continue
      }

      const { error: updateError } = await supabase
        .from('rides')
        .update({
          route_category: result.category,
          classification_confidence: result.confidence,
          classification_method: result.method,
        })
        .eq('id', ride.id)

      if (updateError) {
        console.error(`Failed to update ${ride.id}: ${updateError.message}`)
        errors++
      } else if (result.category === null) {
        nullified++
      } else {
        reclassified++
      }
      processed++
    }

    // Since we're updating rows in the current result set (removing them from
    // the 'other' category), we DON'T increment offset — the next page at
    // offset 0 will have fresh rows. Only increment if we kept all as 'other'.
    if (rides.every(r => {
      const result = classifyRoute({
        summary_polyline: r.summary_polyline,
        distance: r.distance_meters,
        total_elevation_gain: r.elevation_gain_meters,
        start_latlng: r.start_latlng as [number, number] | null,
        end_latlng: r.end_latlng as [number, number] | null,
      })
      return result.category === 'other'
    })) {
      // All in this batch stayed as 'other', move to next page
      offset += PAGE_SIZE
    }
    // Otherwise, re-query at same offset since rows were removed from results

    console.log(`  Progress: nullified=${nullified}, kept=${keptOther}, reclassified=${reclassified}, errors=${errors}`)

    // Safety: if we've processed more than expected, break
    if (processed > (totalOther ?? 0) + 100) {
      console.warn('Safety break — processed more than expected')
      break
    }
  }

  console.log(`\nResults:`)
  console.log(`  Nullified (non-SF2G): ${nullified}`)
  console.log(`  Reclassified to other route: ${reclassified}`)
  console.log(`  Kept as "other": ${keptOther}`)
  console.log(`  Errors: ${errors}`)

  // Verify
  const { count: remainingOther } = await supabase
    .from('rides')
    .select('*', { count: 'exact', head: true })
    .eq('route_category', 'other')

  const { count: nullCount } = await supabase
    .from('rides')
    .select('*', { count: 'exact', head: true })
    .is('route_category', null)

  const { count: totalCount } = await supabase
    .from('rides')
    .select('*', { count: 'exact', head: true })

  console.log(`\nDB state after fix:`)
  console.log(`  Total rides: ${totalCount}`)
  console.log(`  Rides with route_category='other': ${remainingOther}`)
  console.log(`  Rides with route_category=NULL: ${nullCount}`)
  console.log(`  Rides with valid route: ${(totalCount ?? 0) - (remainingOther ?? 0) - (nullCount ?? 0)}`)

  // Refresh views
  console.log('\nRefreshing materialized views...')
  await Promise.allSettled([
    supabase.rpc('refresh_leaderboard'),
    supabase.rpc('refresh_company_leaderboard'),
  ])
  console.log('✅ Done!')
}

main().catch(console.error)
