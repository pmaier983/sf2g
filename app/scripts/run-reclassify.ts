/**
 * Run reclassification on all rides in the database.
 * Run with: npx tsx app/scripts/run-reclassify.ts
 */
import { readFileSync } from 'fs'

// Load .env.local before any imports that need env vars
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
} catch {
  // .env.local may not exist
}

import { createClient } from '@supabase/supabase-js'
import { classifyRoute } from '../lib/route-classifier'
import { classifyDestination } from '../lib/destination-classifier'

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('\n=== Running Reclassification ===\n')

  // Fetch all rides with classification-relevant columns
  const { data: rides, error } = await supabase
    .from('rides')
    .select('id, name, summary_polyline, distance_meters, elevation_gain_meters, start_latlng, end_latlng, route_category, classification_confidence, classification_method, destination_company, destination_office, destination_distance_meters')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch rides:', error.message)
    return
  }

  console.log(`Fetched ${rides?.length ?? 0} rides\n`)

  let updated = 0
  let routeChanges = 0
  const breakdown: Record<string, number> = {}

  for (const ride of rides ?? []) {
    const routeResult = classifyRoute({
      summary_polyline: ride.summary_polyline,
      distance: ride.distance_meters,
      total_elevation_gain: ride.elevation_gain_meters,
      start_latlng: ride.start_latlng as [number, number] | null,
      end_latlng: ride.end_latlng as [number, number] | null,
    })

    const destResult = classifyDestination({
      end_latlng: ride.end_latlng as [number, number] | null,
      summary_polyline: ride.summary_polyline,
    })

    const newCompany = destResult?.company ?? null
    const newOffice = destResult?.officeName ?? null
    const newDistance = destResult?.distanceMeters ?? null

    const routeChanged =
      routeResult.category !== ride.route_category ||
      routeResult.confidence !== ride.classification_confidence ||
      routeResult.method !== ride.classification_method

    const destChanged =
      newCompany !== ride.destination_company ||
      newOffice !== ride.destination_office ||
      newDistance !== ride.destination_distance_meters

    if (!routeChanged && !destChanged) continue

    // Track transitions
    const oldCat = ride.route_category ?? 'null'
    const newCat = routeResult.category ?? 'null'
    if (oldCat !== newCat) {
      const key = `${oldCat} → ${newCat}`
      breakdown[key] = (breakdown[key] ?? 0) + 1
    }

    // Update the ride
    const { error: updateError } = await supabase
      .from('rides')
      .update({
        route_category: routeResult.category,
        classification_confidence: routeResult.confidence,
        classification_method: routeResult.method,
        destination_company: newCompany,
        destination_office: newOffice,
        destination_distance_meters: newDistance,
      })
      .eq('id', ride.id)

    if (updateError) {
      console.error(`Failed to update ride ${ride.id}: ${updateError.message}`)
    } else {
      updated++
      if (routeChanged) routeChanges++
    }
  }

  console.log(`Updated: ${updated} rides`)
  console.log(`Route changes: ${routeChanges}`)
  console.log(`\nCategory transitions:`)
  for (const [transition, count] of Object.entries(breakdown)) {
    console.log(`  ${transition}: ${count}`)
  }

  // Refresh materialized views
  console.log('\nRefreshing leaderboard views...')
  const [lb, clb] = await Promise.allSettled([
    supabase.rpc('refresh_leaderboard'),
    supabase.rpc('refresh_company_leaderboard'),
  ])
  console.log(`  refresh_leaderboard: ${lb.status}`)
  console.log(`  refresh_company_leaderboard: ${clb.status}`)

  console.log('\n✅ Reclassification complete!\n')
}

main().catch(console.error)
