/**
 * DB diagnostic script — queries rides directly and runs the classifier.
 *
 * Usage: npx tsx scripts/db-debug.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { classifyRoute, isInSF, isInPeninsulaCorridor, isCommutableRoute } from '../app/lib/route-classifier.js'

// Load .env.local manually
const envFile = readFileSync('.env.local', 'utf-8')
for (const line of envFile.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  const val = trimmed.slice(eqIdx + 1)
  process.env[key] = val
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  // 1. Count rides by current category
  console.log('\n=== Current DB Category Distribution ===')
  const { data: allRides, error } = await supabase
    .from('rides')
    .select('id, name, route_category, summary_polyline, distance_meters, elevation_gain_meters, start_latlng, end_latlng, classification_method, classification_confidence')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch rides:', error.message)
    process.exit(1)
  }

  console.log(`Total rides: ${allRides.length}`)

  const dbDistribution: Record<string, number> = {}
  for (const ride of allRides) {
    const cat = ride.route_category ?? 'null'
    dbDistribution[cat] = (dbDistribution[cat] ?? 0) + 1
  }
  console.log('DB distribution:', dbDistribution)

  // 2. Now reclassify all rides and compare
  console.log('\n=== Reclassification Results ===')
  const newDistribution: Record<string, number> = {}
  const changes: Array<{ name: string; id: string; old: string; new_: string; method: string }> = []

  for (const ride of allRides) {
    const result = classifyRoute({
      summary_polyline: ride.summary_polyline,
      distance: ride.distance_meters,
      total_elevation_gain: ride.elevation_gain_meters,
      start_latlng: ride.start_latlng,
      end_latlng: ride.end_latlng,
    })

    newDistribution[result.category] = (newDistribution[result.category] ?? 0) + 1

    const oldCat = ride.route_category ?? 'null'
    if (oldCat !== result.category) {
      changes.push({
        name: ride.name ?? 'unnamed',
        id: ride.id,
        old: oldCat,
        new_: result.category,
        method: result.method,
      })
    }
  }

  console.log('New distribution:', newDistribution)
  console.log(`\nTotal changes: ${changes.length}`)

  // 3. Show first 20 changes
  if (changes.length > 0) {
    console.log('\n=== First 30 Category Changes ===')
    for (const c of changes.slice(0, 30)) {
      console.log(`  ${c.name.padEnd(45)} ${c.old.padEnd(10)} → ${c.new_.padEnd(10)} (${c.method})`)
    }
    if (changes.length > 30) {
      console.log(`  ... and ${changes.length - 30} more`)
    }
  }

  // 4. Show transition summary
  const transitions: Record<string, number> = {}
  for (const c of changes) {
    const key = `${c.old} → ${c.new_}`
    transitions[key] = (transitions[key] ?? 0) + 1
  }
  console.log('\n=== Transition Summary ===')
  for (const [t, count] of Object.entries(transitions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${count}`)
  }

  // 5. Sample a few bayway rides to understand why they're bayway
  const baywayRides = allRides.filter(r => r.route_category === 'bayway')
  console.log(`\n=== Sample Bayway Rides (${baywayRides.length} total) ===`)
  for (const ride of baywayRides.slice(0, 5)) {
    console.log(`\n  ${ride.name} (${ride.id})`)
    console.log(`    start_latlng: ${JSON.stringify(ride.start_latlng)}`)
    console.log(`    end_latlng: ${JSON.stringify(ride.end_latlng)}`)
    console.log(`    distance: ${ride.distance_meters ? (ride.distance_meters / 1000).toFixed(1) : 'null'}km`)
    console.log(`    elevation: ${ride.elevation_gain_meters?.toFixed(0) ?? 'null'}m`)
    console.log(`    polyline: ${ride.summary_polyline ? `${ride.summary_polyline.length} chars` : 'null'}`)
    console.log(`    DB method: ${ride.classification_method}`)
    console.log(`    DB confidence: ${ride.classification_confidence}`)

    const startSF = isInSF(ride.start_latlng)
    const endSF = isInSF(ride.end_latlng)
    const startCorridor = isInPeninsulaCorridor(ride.start_latlng)
    const endCorridor = isInPeninsulaCorridor(ride.end_latlng)
    const commutable = isCommutableRoute({
      summary_polyline: ride.summary_polyline,
      distance: ride.distance_meters,
      total_elevation_gain: ride.elevation_gain_meters,
      start_latlng: ride.start_latlng,
      end_latlng: ride.end_latlng,
    })

    console.log(`    startInSF: ${startSF}, endInSF: ${endSF}`)
    console.log(`    startInCorridor: ${startCorridor}, endInCorridor: ${endCorridor}`)
    console.log(`    commutable: ${commutable}`)

    const reclassified = classifyRoute({
      summary_polyline: ride.summary_polyline,
      distance: ride.distance_meters,
      total_elevation_gain: ride.elevation_gain_meters,
      start_latlng: ride.start_latlng,
      end_latlng: ride.end_latlng,
    })
    console.log(`    Reclassified: ${reclassified.category} (${reclassified.method}, conf=${reclassified.confidence})`)
  }
}

main().catch(console.error)
