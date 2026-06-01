/**
 * Diagnostic: check why Skyline rides aren't being classified correctly.
 * Run with: npx tsx app/lib/__test__/debug-skyline.ts
 */
import { classifyRoute, isInSF, isInPeninsulaCorridor, isCommutableRoute } from '../route-classifier'
import { decodePolyline } from '../polyline'
import { ROUTE_GATEWAYS, GATEWAY_RADIUS_METERS } from '../constants'
import rides from './fixtures/rides-fixture.json'

// Find rides that have "SF2G" in the name
const sf2gRides = (rides as any[]).filter(r => 
  r.name && r.name.toLowerCase().includes('sf2g')
)

console.log(`\n=== SF2G Rides: ${sf2gRides.length} total ===\n`)

for (const ride of sf2gRides.slice(0, 5)) {
  console.log(`--- ${ride.name} (${ride.strava_activity_id}) ---`)
  console.log(`  Distance: ${(ride.distance / 1000).toFixed(1)}km`)
  console.log(`  Elevation: ${ride.total_elevation_gain?.toFixed(0)}m`)
  console.log(`  Start: ${JSON.stringify(ride.start_latlng)}`)
  console.log(`  End: ${JSON.stringify(ride.end_latlng)}`)
  console.log(`  Has polyline: ${!!ride.summary_polyline} (${ride.summary_polyline?.length ?? 0} chars)`)
  console.log(`  DB category: ${ride.current_category}`)

  // Check commute filter
  const startInSF = isInSF(ride.start_latlng)
  const endInSF = isInSF(ride.end_latlng)
  const startInCorridor = isInPeninsulaCorridor(ride.start_latlng)
  const endInCorridor = isInPeninsulaCorridor(ride.end_latlng)
  const commutable = isCommutableRoute({
    summary_polyline: ride.summary_polyline,
    distance: ride.distance,
    total_elevation_gain: ride.total_elevation_gain,
    start_latlng: ride.start_latlng,
    end_latlng: ride.end_latlng,
  })
  
  console.log(`  Start in SF: ${startInSF}, End in SF: ${endInSF}`)
  console.log(`  Start in corridor: ${startInCorridor}, End in corridor: ${endInCorridor}`)
  console.log(`  Commutable: ${commutable}`)

  // Check gateway proximity
  if (ride.summary_polyline) {
    const points = decodePolyline(ride.summary_polyline)
    console.log(`  Polyline points: ${points.length}`)
    
    for (const gateway of ROUTE_GATEWAYS) {
      let minDist = Infinity
      for (const [lat, lng] of points) {
        const dist = haversine(lat, lng, gateway.lat, gateway.lng)
        if (dist < minDist) minDist = dist
      }
      const hit = minDist <= GATEWAY_RADIUS_METERS
      console.log(`    ${gateway.name}: ${minDist.toFixed(0)}m ${hit ? '✅ HIT' : '❌ MISS'}`)
    }
  }

  // Final classification
  const result = classifyRoute({
    summary_polyline: ride.summary_polyline,
    distance: ride.distance,
    total_elevation_gain: ride.total_elevation_gain,
    start_latlng: ride.start_latlng,
    end_latlng: ride.end_latlng,
  })
  console.log(`  Classified: ${result.category} (${result.method}, conf=${result.confidence})`)
  console.log(`  Matched gateways: ${result.matchedGateways?.join(', ') ?? 'none'}`)
  console.log()
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
