/**
 * Apply reclassification — queries rides, runs classifier, updates DB.
 * Usage: npx tsx scripts/db-apply-reclassify.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { classifyRoute } from '../app/lib/route-classifier.js'
import { classifyDestination } from '../app/lib/destination-classifier.js'

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env'); process.exit(1) }
const supabase = createClient(url, key)

async function main() {
  const startTime = Date.now()

  // Fetch all rides
  const { data: allRides, error } = await supabase
    .from('rides')
    .select('id, name, summary_polyline, distance_meters, elevation_gain_meters, start_latlng, end_latlng, route_category, classification_confidence, classification_method, destination_company, destination_office, destination_distance_meters')

  if (error || !allRides) {
    console.error('Failed to fetch:', error?.message)
    process.exit(1)
  }

  console.log(`\nFetched ${allRides.length} rides`)

  // Classify and find changes
  let routeChanges = 0
  let destChanges = 0
  const updates: Array<{ id: string; route_category: string; classification_confidence: number; classification_method: string; destination_company: string | null; destination_office: string | null; destination_distance_meters: number | null }> = []

  for (const ride of allRides) {
    const routeResult = classifyRoute({
      summary_polyline: ride.summary_polyline,
      distance: ride.distance_meters,
      total_elevation_gain: ride.elevation_gain_meters,
      start_latlng: ride.start_latlng,
      end_latlng: ride.end_latlng,
    })

    const destResult = classifyDestination({
      end_latlng: ride.end_latlng,
      summary_polyline: ride.summary_polyline,
    })

    const newCompany = destResult?.company ?? null
    const newOffice = destResult?.officeName ?? null
    const newDist = destResult?.distanceMeters ?? null

    const rChanged = routeResult.category !== ride.route_category ||
      routeResult.confidence !== ride.classification_confidence ||
      routeResult.method !== ride.classification_method

    const dChanged = newCompany !== ride.destination_company ||
      newOffice !== ride.destination_office ||
      newDist !== ride.destination_distance_meters

    if (rChanged || dChanged) {
      if (rChanged) routeChanges++
      if (dChanged) destChanges++
      updates.push({
        id: ride.id,
        route_category: routeResult.category,
        classification_confidence: routeResult.confidence,
        classification_method: routeResult.method,
        destination_company: newCompany,
        destination_office: newOffice,
        destination_distance_meters: newDist,
      })
    }
  }

  console.log(`Route changes: ${routeChanges}`)
  console.log(`Destination changes: ${destChanges}`)
  console.log(`Total updates needed: ${updates.length}`)

  if (updates.length === 0) {
    console.log('\nNo changes needed!')
    return
  }

  // Apply updates one by one (simple, reliable)
  console.log('\nApplying updates...')
  let success = 0
  let errors = 0

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i]
    const { error: updateError } = await supabase
      .from('rides')
      .update({
        route_category: u.route_category,
        classification_confidence: u.classification_confidence,
        classification_method: u.classification_method,
        destination_company: u.destination_company,
        destination_office: u.destination_office,
        destination_distance_meters: u.destination_distance_meters,
      })
      .eq('id', u.id)

    if (updateError) {
      console.error(`  Failed ${u.id}: ${updateError.message}`)
      errors++
    } else {
      success++
    }

    // Progress
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${updates.length} processed...`)
    }
  }

  console.log(`\nUpdated: ${success}, Errors: ${errors}`)

  // Refresh materialized views
  console.log('\nRefreshing materialized views...')
  const { error: refreshErr1 } = await supabase.rpc('refresh_leaderboard')
  if (refreshErr1) console.error('  Leaderboard refresh failed:', refreshErr1.message)
  else console.log('  ✅ Leaderboard refreshed')

  const { error: refreshErr2 } = await supabase.rpc('refresh_company_leaderboard')
  if (refreshErr2) console.error('  Company leaderboard refresh failed:', refreshErr2.message)
  else console.log('  ✅ Company leaderboard refreshed')

  // Verify
  console.log('\nVerifying...')
  const { data: verifyRides } = await supabase.from('rides').select('route_category')
  const newDist2: Record<string, number> = {}
  for (const r of verifyRides ?? []) {
    const cat = r.route_category ?? 'null'
    newDist2[cat] = (newDist2[cat] ?? 0) + 1
  }
  console.log('New DB distribution:', newDist2)
  console.log(`\nDone in ${Date.now() - startTime}ms`)
}

main().catch(console.error)
