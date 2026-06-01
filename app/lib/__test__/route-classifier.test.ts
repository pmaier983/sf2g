/**
 * Route classification tests.
 *
 * Uses real Strava ride data (894 rides) to validate the classifier.
 *
 * Ground truth from the rider:
 *   - Almost all SF2G commutes are SKYLINE
 *   - "SF2G long way" and "BTWD w/Apple folks" are HMBW
 *   - Maybe 1 ride is BAYWAY, none are ROYALE
 *   - Local rides (Egan, Page Mill, Marin loops, etc.) should be "other"
 *
 * A "commute" is defined as a ride starting near PPR/SF (37.775, -122.438)
 * and ending near Google/Sunnyvale (37.422, -122.079), or vice versa.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyRoute,
  isInSF,
  isInPeninsulaCorridor,
  isCommutableRoute,
  type ClassifiableActivity,
  type ClassificationResult,
} from '../route-classifier'
import rides from './fixtures/rides-fixture.json'

// ---------------------------------------------------------------------------
// Types for the fixture data
// ---------------------------------------------------------------------------

interface RideFixture {
  strava_activity_id: number
  name: string | null
  ride_date: string
  summary_polyline: string | null
  distance: number
  total_elevation_gain: number
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
  is_commute: boolean
  current_category: string | null
  current_confidence: number
  current_method: string | null
}

const allRides = rides as RideFixture[]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toClassifiableActivity(ride: RideFixture): ClassifiableActivity {
  return {
    summary_polyline: ride.summary_polyline,
    distance: ride.distance,
    total_elevation_gain: ride.total_elevation_gain,
    start_latlng: ride.start_latlng,
    end_latlng: ride.end_latlng,
  }
}

function findRideByName(nameSubstring: string): RideFixture {
  const ride = allRides.find(
    (r) =>
      r.name &&
      r.name.toLowerCase().includes(nameSubstring.toLowerCase()),
  )
  if (!ride) throw new Error(`No ride found matching "${nameSubstring}"`)
  return ride
}

function findRideById(id: number): RideFixture {
  const ride = allRides.find((r) => r.strava_activity_id === id)
  if (!ride) throw new Error(`No ride found with ID ${id}`)
  return ride
}

function classifyFixtureRide(ride: RideFixture): ClassificationResult {
  return classifyRoute(toClassifiableActivity(ride))
}

/** Is this coordinate in the SF/PPR area? */
function isSFArea(latlng: [number, number] | null): boolean {
  if (!latlng) return false
  return 37.7 < latlng[0] && latlng[0] < 37.8 && -122.5 < latlng[1] && latlng[1] < -122.4
}

/** Is this coordinate in the Google/Sunnyvale area? */
function isGoogleArea(latlng: [number, number] | null): boolean {
  if (!latlng) return false
  return 37.38 < latlng[0] && latlng[0] < 37.45 && -122.12 < latlng[1] && latlng[1] < -122.05
}

/** Is this ride a commute between SF and Google? */
function isCommute(ride: RideFixture): boolean {
  return (
    (isSFArea(ride.start_latlng) && isGoogleArea(ride.end_latlng)) ||
    (isGoogleArea(ride.start_latlng) && isSFArea(ride.end_latlng))
  )
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Route Classifier', () => {
  // =========================================================================
  // Unit tests for basic classification logic
  // =========================================================================

  describe('basic classification', () => {
    it('should return null for activities without start/end coordinates (commute filter)', () => {
      const result = classifyRoute({
        summary_polyline: null,
        distance: 50000,
        total_elevation_gain: 500,
      })
      // No start/end latlng → fails commute filter → null (not an SF2G ride)
      expect(result.category).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('should still classify via elevation when commute filter passes but no polyline', () => {
      const result = classifyRoute({
        summary_polyline: null,
        distance: 50000,
        total_elevation_gain: 500,
        start_latlng: [37.775, -122.438], // SF
        end_latlng: [37.422, -122.079],   // Google
      })
      // Passes commute filter, no polyline → elevation fallback
      expect(result.method).toBe('elevation')
      expect(result.category).not.toBe('other')
    })

    it('should return null for short rides without polyline', () => {
      const result = classifyRoute({
        summary_polyline: null,
        distance: 5000,
        total_elevation_gain: 50,
      })
      expect(result.category).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('should return null for very short real rides', () => {
      // 6km night ride home — definitely not a commute
      const nightRide = findRideByName('Night Ride')
      const result = classifyFixtureRide(nightRide)
      expect(result.category).toBeNull()
    })
  })

  // =========================================================================
  // Known SF2G SKYLINE commutes (user confirmed)
  // =========================================================================

  describe('known skyline commutes (user confirmed)', () => {
    // All standard SF2G commutes are Skyline (~74km, ~700m elev, SF→Google).
    // There are 23 total skyline rides confirmed by the rider.
    // All rides match both Skyline North and Skyline South gateways.
    const knownSkylineIds = [
      18676290163, // SF2G Rolling
      18583481371, // SF2G chilling
      18478421575, // Another Speedy SF2G
      18400113549, // Speedy SF2G
      18320395312, // SF2G - speedy
      18293363250, // Sf2G - No Power pedals
      18105878687, // Chill SF2G
      18042169904, // Speedy SF2G (78km variant)
      18014453652, // SF2G slightly spicy
      17951150820, // Zooming SF2G
      17841701248, // SF2G
      17780414685, // SF2G clipper
      17755147405, // Big Group for SF2G
      17697892609, // A spicy Chilly SF2G
      17673549893, // Chilly SF2G
      17614755881, // Fastest SF2G yet
      17590041258, // SF2G
      17352293996, // V Spicy SF2G
      17296886568, // SF2G
      17048731641, // SF2G
      16980739716, // SF2G
      16303504831, // SF2G
      16294001838, // SF2G
    ]

    for (const id of knownSkylineIds) {
      const ride = findRideById(id)
      it(`should classify "${ride.name}" (${id}) as skyline with high confidence`, () => {
        const result = classifyFixtureRide(ride)
        expect(result.category).toBe('skyline')
        // All skyline rides hit both North and South gateways
        expect(result.confidence).toBe(0.95)
        expect(result.method).toBe('gateway')
        expect(result.matchedGateways).toBeDefined()
        expect(result.matchedGateways!.length).toBe(2)
      })
    }

    it('should have exactly 23 confirmed skyline rides', () => {
      expect(knownSkylineIds.length).toBe(23)
    })
  })

  // =========================================================================
  // Known SF2G HMBW commutes (user confirmed)
  // =========================================================================

  describe('known HMBW commutes (user confirmed)', () => {
    const knownHMBWIds = [
      18596930559, // BTWD w/Apple folks — 105km, 1458m elev
      17547770362, // SF2G long way — 101km, 1528m elev (if this ID exists)
    ]

    for (const id of knownHMBWIds) {
      try {
        const ride = findRideById(id)
        it(`should classify "${ride.name}" (${id}) as hmbw`, () => {
          const result = classifyFixtureRide(ride)
          expect(result.category).toBe('hmbw')
          expect(result.method).toBe('gateway')
        })
      } catch {
        // Skip if ride not in fixture
      }
    }

    it('should classify "SF2G long way" as hmbw', () => {
      const ride = findRideByName('SF2G long way')
      const result = classifyFixtureRide(ride)
      expect(result.category).toBe('hmbw')
      expect(result.method).toBe('gateway')
    })

    it('should classify "BTWD w/Apple folks" as hmbw', () => {
      const ride = findRideByName('BTWD w/Apple folks')
      const result = classifyFixtureRide(ride)
      expect(result.category).toBe('hmbw')
      expect(result.method).toBe('gateway')
    })
  })

  // =========================================================================
  // Known FLEAWAY commutes (synthetic test fixtures)
  // =========================================================================

  describe('known fleaway commutes (synthetic fixtures)', () => {
    // Synthetic rides with generated polylines that pass through both Fleaway
    // gateways (North: 37.624205, -122.408411 and South: 37.492333, -122.266346).
    // Route goes SF → Fleaway North → Fleaway South → Google.
    // Strava activity IDs reference real rides we can't scrape (auth wall).
    const fleawayPolyline =
      'w|peFnthjVn{D_d@n{D_d@n{D}c@n{D_d@l{D_d@??zcDqpDxcDqpDzcDspDxcDqpDzcDqpD??zvAeiF|vAeiFzvAeiFzvAeiF|vAeiF'

    const syntheticFleawayRides: Array<{
      id: number
      name: string
      activity: ClassifiableActivity
    }> = [
      {
        id: 14204976288,
        name: 'Fleaway commute (synthetic #1)',
        activity: {
          summary_polyline: fleawayPolyline,
          distance: 65000, // ~65km
          total_elevation_gain: 200,
          start_latlng: [37.775, -122.438],
          end_latlng: [37.422, -122.079],
        },
      },
      {
        id: 12790114753,
        name: 'Fleaway commute (synthetic #2)',
        activity: {
          summary_polyline: fleawayPolyline,
          distance: 63500, // ~63.5km
          total_elevation_gain: 180,
          start_latlng: [37.775, -122.438],
          end_latlng: [37.422, -122.079],
        },
      },
      {
        id: 10682270764,
        name: 'Fleaway commute (synthetic #3)',
        activity: {
          summary_polyline: fleawayPolyline,
          distance: 66200, // ~66.2km
          total_elevation_gain: 220,
          start_latlng: [37.775, -122.438],
          end_latlng: [37.422, -122.079],
        },
      },
      {
        id: 8127111,
        name: 'Fleaway commute (synthetic #4)',
        activity: {
          summary_polyline: fleawayPolyline,
          distance: 64800, // ~64.8km
          total_elevation_gain: 190,
          start_latlng: [37.775, -122.438],
          end_latlng: [37.422, -122.079],
        },
      },
    ]

    for (const ride of syntheticFleawayRides) {
      it(`should classify "${ride.name}" (${ride.id}) as fleaway with high confidence`, () => {
        const result = classifyRoute(ride.activity)
        expect(result.category).toBe('fleaway')
        expect(result.confidence).toBe(0.95)
        expect(result.method).toBe('gateway')
        expect(result.matchedGateways).toBeDefined()
        expect(result.matchedGateways!.length).toBe(2)
      })
    }

    it('should have exactly 4 synthetic fleaway rides', () => {
      expect(syntheticFleawayRides.length).toBe(4)
    })
  })

  // =========================================================================
  // Known MEBW commute (synthetic test fixture)
  // =========================================================================

  describe('known MEBW commutes (synthetic fixtures)', () => {
    // Synthetic ride with a generated polyline that passes through both MEBW
    // gateways (North: 37.682566, -122.177678 and South: 37.508820, -122.114224).
    // Route goes SF → Bay Bridge → MEBW North (Castro Valley) → MEBW South
    // (Fremont) → back to Google. The ride crosses into the East Bay for the
    // gateways but still satisfies the commute filter (SF start, peninsula end).
    const mebwPolyline =
      'w|peFnthjViSsvEiSsvEiSsvEiSsvE??tlCioErlCkoEtlCioE??~lAom@~lAom@|lAom@??dxEinAdxEinAdxEinAdxEknAdxEinA??fkAmt@hkAot@fkAmt@hkAot@??dnAaAbnAcAdnAaA'

    const syntheticMEBWRide = {
      id: 143176030,
      name: 'MEBW commute (synthetic)',
      activity: {
        summary_polyline: mebwPolyline,
        distance: 55000, // ~55km
        total_elevation_gain: 400,
        start_latlng: [37.775, -122.438] as [number, number],
        end_latlng: [37.422, -122.079] as [number, number],
      },
    }

    it(`should classify "${syntheticMEBWRide.name}" (${syntheticMEBWRide.id}) as mebw with high confidence`, () => {
      const result = classifyRoute(syntheticMEBWRide.activity)
      expect(result.category).toBe('mebw')
      expect(result.confidence).toBe(0.95)
      expect(result.method).toBe('gateway')
      expect(result.matchedGateways).toBeDefined()
      expect(result.matchedGateways!.length).toBe(2)
    })
  })

  // =========================================================================
  // Known FEBW commute (synthetic test fixture)
  // =========================================================================

  describe('known FEBW commutes (synthetic fixtures)', () => {
    // Synthetic ride with a generated polyline that passes through both FEBW
    // gateways (North: 37.814338, -122.144205 and South: 37.669102, -122.001220).
    // Route goes SF → Bay Bridge → FEBW North (Berkeley Hills) → FEBW South
    // (Dublin / Pleasanton) → back south to Google. The ride detours through
    // the far East Bay but still satisfies the commute filter (SF start, peninsula end).
    const febwPolyline =
      'w|peFnthjV_|Bo}Yw|A_pRcZu{IrrIipK~xF_yFb}HkqFznLjtB~rNnzD~uJ~{BnlFfw@'

    const syntheticFEBWRide = {
      id: 222746,
      name: 'FEBW commute (synthetic)',
      activity: {
        summary_polyline: febwPolyline,
        distance: 60000, // ~60km
        total_elevation_gain: 600,
        start_latlng: [37.775, -122.438] as [number, number],
        end_latlng: [37.422, -122.079] as [number, number],
      },
    }

    it(`should classify "${syntheticFEBWRide.name}" (${syntheticFEBWRide.id}) as febw with high confidence`, () => {
      const result = classifyRoute(syntheticFEBWRide.activity)
      expect(result.category).toBe('febw')
      expect(result.confidence).toBe(0.95)
      expect(result.method).toBe('gateway')
      expect(result.matchedGateways).toBeDefined()
      expect(result.matchedGateways!.length).toBe(2)
    })
  })

  // =========================================================================
  // Known NON-SF2G rides (user confirmed)
  // =========================================================================

  describe('known non-SF2G rides (user confirmed)', () => {
    it('should classify "SF2SF" as null (loop ride, starts and ends in SF — not an SF2G ride)', () => {
      const ride = findRideByName('SF2SF')
      const result = classifyFixtureRide(ride)
      expect(result.category).toBeNull()
    })

    it('should classify "SF2G + the cube" as null (loop ride, starts and ends in SF — not an SF2G ride)', () => {
      const ride = findRideByName('cube')
      const result = classifyFixtureRide(ride)
      expect(result.category).toBeNull()
    })
  })

  // =========================================================================
  // Commute identification — all SF↔Google rides should be classified
  // =========================================================================

  describe('commute detection', () => {
    it('should identify ~30 commutes between SF and Google', () => {
      const commutes = allRides.filter(isCommute)
      expect(commutes.length).toBeGreaterThanOrEqual(25)
      expect(commutes.length).toBeLessThanOrEqual(40)
    })

    it('should classify long commutes (>40km) as skyline or hmbw', () => {
      const commutes = allRides.filter(
        (r) => isCommute(r) && r.distance > 40000,
      )
      expect(commutes.length).toBeGreaterThanOrEqual(20)

      for (const ride of commutes) {
        const result = classifyFixtureRide(ride)
        expect(
          ['skyline', 'hmbw', 'bayway'],
          `"${ride.name}" (${ride.strava_activity_id}) was classified as ${result.category}`,
        ).toContain(result.category)
      }
    })
  })

  // =========================================================================
  // Non-commute rides should NOT be classified as SF2G routes
  // =========================================================================

  describe('false positive detection', () => {
    it('should not classify short local rides as named SF2G routes', () => {
      const shortRides = allRides.filter(
        (r) => (r.distance ?? 0) < 10000 && r.summary_polyline,
      )
      expect(shortRides.length).toBeGreaterThan(0)

      for (const ride of shortRides.slice(0, 10)) {
        const result = classifyFixtureRide(ride)
        // Short rides should be null (non-SF2G) or 'other' (SF2G alternate)
        // but never a named route like skyline, bayway, etc.
        expect(
          result.category === null || result.category === 'other',
          `Short ride "${ride.name}" should not be a named SF2G route, got: ${result.category}`,
        ).toBe(true)
      }
    })

    // These are known false positives from elevation fallback
    // User confirmed: Egan rides, Page Mill rides, Marin loops are NOT SF2G commutes

    it('should classify "Egan" rides as null (filtered by commute endpoints — not SF2G rides)', () => {
      const eganRides = allRides.filter(
        (r) => r.name && r.name.toLowerCase().includes('egan'),
      )
      expect(eganRides.length).toBeGreaterThan(5)

      for (const ride of eganRides) {
        const result = classifyFixtureRide(ride)
        expect(
          result.category,
          `"${ride.name}" should be null (start/end both near Google)`,
        ).toBeNull()
      }
    })

    it('should classify "Page Milling" rides as null (filtered by commute endpoints — not SF2G rides)', () => {
      const pageMillRides = allRides.filter(
        (r) => r.name && r.name.toLowerCase().includes('page mill'),
      )
      expect(pageMillRides.length).toBeGreaterThan(3)

      for (const ride of pageMillRides) {
        const result = classifyFixtureRide(ride)
        expect(
          result.category,
          `"${ride.name}" should be null`,
        ).toBeNull()
      }
    })

    it('should classify Marin loop rides as null (filtered by commute endpoints — not SF2G rides)', () => {
      const marinRides = allRides.filter(
        (r) => r.name && r.name.toLowerCase().includes('marin'),
      )
      expect(marinRides.length).toBeGreaterThan(2)

      for (const ride of marinRides) {
        const result = classifyFixtureRide(ride)
        expect(
          result.category,
          `"${ride.name}" should be null (loop ride, start/end both in SF)`,
        ).toBeNull()
      }
    })

    it('should classify the Levis Fondo as null (filtered by commute endpoints — not an SF2G ride)', () => {
      const fondo = findRideByName('Levis Fondo')
      const result = classifyFixtureRide(fondo)
      expect(result.category).toBeNull()
    })

    it('should classify rides in China as null (filtered by commute endpoints — not SF2G rides)', () => {
      const chinaRides = allRides.filter(
        (r) => {
          const s = r.start_latlng
          return s && s[1] > 0 // Positive longitude = east of Greenwich
        },
      )
      expect(chinaRides.length).toBeGreaterThan(0)

      for (const ride of chinaRides) {
        const result = classifyFixtureRide(ride)
        expect(result.category).toBeNull()
      }
    })
  })

  // =========================================================================
  // Classification distribution tracking
  // =========================================================================

  describe('classification distribution', () => {
    it('should classify all SF2G commute rides (SF→Google) as non-other', () => {
      // SF2G-named rides that go from SF to Google should be classified.
      // Note: "SF2G + the cube" is a loop (start/end in SF) so it's excluded.
      const sf2gCommutes = allRides.filter((r) => {
        if (!r.name || !r.name.toLowerCase().includes('sf2g')) return false
        return isCommutableRoute(toClassifiableActivity(r))
      })
      expect(sf2gCommutes.length).toBeGreaterThan(15)

      const results = sf2gCommutes.map((r) => ({
        name: r.name,
        result: classifyFixtureRide(r),
      }))

      const nonOther = results.filter((r) => r.result.category !== 'other')
      // ALL SF2G commute rides should be classified
      expect(nonOther.length).toBe(sf2gCommutes.length)
    })

    it('should print classification distribution for visibility', () => {
      const results = allRides.map((r) => ({
        name: r.name,
        id: r.strava_activity_id,
        ...classifyFixtureRide(r),
      }))

      const distribution: Record<string, number> = {}
      for (const r of results) {
        const key = r.category ?? 'null'
        distribution[key] = (distribution[key] ?? 0) + 1
      }

      console.log('\n📊 Classification Distribution:')
      for (const [cat, count] of Object.entries(distribution).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(
          `  ${cat}: ${count} (${((count / allRides.length) * 100).toFixed(1)}%)`,
        )
      }
    })

    it('should report false positive count from elevation fallback', () => {
      const nonCommutes = allRides.filter((r) => !isCommute(r))
      const falsePositives = nonCommutes.filter((r) => {
        const result = classifyFixtureRide(r)
        return result.category !== null && result.category !== 'other'
      })

      console.log(
        `\n⚠️  False positives: ${falsePositives.length} non-commute rides classified as SF2G routes`,
      )
      const byMethod: Record<string, number> = {}
      const byCat: Record<string, number> = {}
      for (const r of falsePositives) {
        const result = classifyFixtureRide(r)
        byMethod[result.method] = (byMethod[result.method] ?? 0) + 1
        byCat[result.category!] = (byCat[result.category!] ?? 0) + 1
      }
      console.log('  By method:', byMethod)
      console.log('  By category:', byCat)

      // After commute endpoint filtering, there should be 0 false positives!
      expect(falsePositives.length).toBe(0)
    })
  })

  // =========================================================================
  // Gateway matching accuracy
  // =========================================================================

  describe('gateway matching', () => {
    it('should use gateway method for commutable rides with polylines', () => {
      const commutableWithPolylines = allRides.filter(
        (r) =>
          r.summary_polyline &&
          r.summary_polyline.length > 100 &&
          isCommutableRoute(toClassifiableActivity(r)),
      )
      expect(commutableWithPolylines.length).toBeGreaterThan(20)

      const results = commutableWithPolylines.map((r) => ({
        name: r.name,
        result: classifyFixtureRide(r),
      }))

      const gatewayResults = results.filter(
        (r) => r.result.method === 'gateway',
      )
      // Most commutable rides with polylines should be classified via gateway
      expect(gatewayResults.length).toBeGreaterThan(commutableWithPolylines.length * 0.8)
    })

    it('should produce matchedGateways when classified by gateway', () => {
      const ridesWithPolylines = allRides.filter(
        (r) => r.summary_polyline && r.summary_polyline.length > 100,
      )

      for (const ride of ridesWithPolylines.slice(0, 50)) {
        const result = classifyFixtureRide(ride)
        if (result.method === 'gateway' && result.category !== 'other' && result.category !== null) {
          expect(result.matchedGateways).toBeDefined()
          expect(result.matchedGateways!.length).toBeGreaterThan(0)
        }
      }
    })
  })

  // =========================================================================
  // Consistency checks
  // =========================================================================

  describe('classification consistency', () => {
    it('should classify identically-named SF2G rides the same way', () => {
      const sf2gExactRides = allRides.filter((r) => r.name === 'SF2G')
      if (sf2gExactRides.length < 2) return

      const results = sf2gExactRides.map(classifyFixtureRide)
      const categories = new Set(results.map((r) => r.category))
      expect(categories.size).toBe(1)
    })

    it('should be deterministic — same input always produces same output', () => {
      const ride = findRideByName('SF2G Rolling')
      const result1 = classifyFixtureRide(ride)
      const result2 = classifyFixtureRide(ride)
      expect(result1).toEqual(result2)
    })
  })

  // =========================================================================
  // Elevation fallback
  // =========================================================================

  describe('elevation fallback', () => {
    it('should not classify rides under 40km via elevation', () => {
      const shortRidesNoGateway = allRides.filter((r) => {
        if ((r.distance ?? 0) >= 40000) return false
        const result = classifyFixtureRide(r)
        return result.method === 'elevation'
      })
      expect(shortRidesNoGateway.length).toBe(0)
    })
  })

  // =========================================================================
  // Detailed classification report
  // =========================================================================

  describe('detailed report', () => {
    it('should log mismatches between DB and computed classification', () => {
      const mismatches: Array<{
        name: string | null
        id: number
        dbCategory: string | null
        computedCategory: string | null
        computedMethod: string
        distance_km: number
        elevation: number
      }> = []

      for (const ride of allRides) {
        const result = classifyFixtureRide(ride)
        // Compare: DB stores null for non-SF2G, 'other' for alternate SF2G routes
        const dbCat = ride.current_category ?? null
        if (result.category !== dbCat) {
          mismatches.push({
            name: ride.name,
            id: ride.strava_activity_id,
            dbCategory: ride.current_category,
            computedCategory: result.category,
            computedMethod: result.method,
            distance_km: Math.round(ride.distance / 1000),
            elevation: Math.round(ride.total_elevation_gain),
          })
        }
      }

      if (mismatches.length > 0) {
        console.log(
          `\n⚠️  ${mismatches.length} classification mismatches between DB and computed:`,
        )
        for (const m of mismatches.slice(0, 20)) {
          console.log(
            `  ${(m.name ?? 'unnamed').padEnd(40)} DB=${(m.dbCategory ?? 'null').padEnd(8)} Computed=${(m.computedCategory ?? 'null').padEnd(8)} (${m.computedMethod}) ${m.distance_km}km/${m.elevation}m`,
          )
        }
        if (mismatches.length > 20) {
          console.log(`  ... and ${mismatches.length - 20} more`)
        }
      } else {
        console.log('\n✅ No classification mismatches!')
      }
    })
  })

  // =========================================================================
  // Zone helper functions
  // =========================================================================

  describe('zone helpers', () => {
    describe('isInSF', () => {
      it('should identify PPR (Panhandle/Park) as in SF', () => {
        expect(isInSF([37.775, -122.438])).toBe(true)
      })

      it('should identify the Embarcadero as in SF', () => {
        expect(isInSF([37.793, -122.394])).toBe(true)
      })

      it('should identify Ocean Beach as in SF', () => {
        expect(isInSF([37.760, -122.510])).toBe(true)
      })

      it('should NOT identify Google/Mountain View as in SF', () => {
        expect(isInSF([37.422, -122.079])).toBe(false)
      })

      it('should NOT identify Marin as in SF', () => {
        expect(isInSF([37.850, -122.480])).toBe(false)
      })

      it('should return false for null', () => {
        expect(isInSF(null)).toBe(false)
      })
    })

    describe('isInPeninsulaCorridor', () => {
      it('should identify Google campus as in corridor', () => {
        expect(isInPeninsulaCorridor([37.422, -122.079])).toBe(true)
      })

      it('should identify Stanford as in corridor', () => {
        expect(isInPeninsulaCorridor([37.427, -122.170])).toBe(true)
      })

      it('should identify Palo Alto (downtown) as in corridor', () => {
        expect(isInPeninsulaCorridor([37.443, -122.143])).toBe(true)
      })

      it('should identify San Mateo as in corridor', () => {
        expect(isInPeninsulaCorridor([37.560, -122.310])).toBe(true)
      })

      it('should NOT identify SF as in corridor', () => {
        expect(isInPeninsulaCorridor([37.775, -122.438])).toBe(false)
      })

      it('should NOT identify Half Moon Bay (west of 280) as in corridor', () => {
        expect(isInPeninsulaCorridor([37.460, -122.430])).toBe(false)
      })

      it('should NOT identify Marin as in corridor', () => {
        expect(isInPeninsulaCorridor([37.850, -122.480])).toBe(false)
      })

      it('should NOT identify Sonoma (Levis Fondo) as in corridor', () => {
        expect(isInPeninsulaCorridor([38.550, -122.810])).toBe(false)
      })

      it('should return false for null', () => {
        expect(isInPeninsulaCorridor(null)).toBe(false)
      })
    })

    describe('isCommutableRoute', () => {
      it('should return true for SF → Google commute', () => {
        expect(
          isCommutableRoute({
            summary_polyline: null,
            distance: 74000,
            total_elevation_gain: 700,
            start_latlng: [37.775, -122.438],
            end_latlng: [37.422, -122.079],
          }),
        ).toBe(true)
      })

      it('should return true for Google → SF reverse commute', () => {
        expect(
          isCommutableRoute({
            summary_polyline: null,
            distance: 74000,
            total_elevation_gain: 700,
            start_latlng: [37.422, -122.079],
            end_latlng: [37.775, -122.438],
          }),
        ).toBe(true)
      })

      it('should return false for SF → SF loop', () => {
        expect(
          isCommutableRoute({
            summary_polyline: null,
            distance: 50000,
            total_elevation_gain: 500,
            start_latlng: [37.775, -122.438],
            end_latlng: [37.760, -122.420],
          }),
        ).toBe(false)
      })

      it('should return false for Google → Google loop', () => {
        expect(
          isCommutableRoute({
            summary_polyline: null,
            distance: 50000,
            total_elevation_gain: 800,
            start_latlng: [37.422, -122.079],
            end_latlng: [37.408, -122.108],
          }),
        ).toBe(false)
      })

      it('should return false for rides with no start/end', () => {
        expect(
          isCommutableRoute({
            summary_polyline: null,
            distance: 74000,
            total_elevation_gain: 700,
          }),
        ).toBe(false)
      })
    })
  })
})
