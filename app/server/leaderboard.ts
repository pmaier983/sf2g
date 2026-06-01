/**
 * Leaderboard server functions.
 *
 * - `fetchLeaderboard` — queries the leaderboard_view materialized view
 *   (or falls back to date-filtered RPC when dateFrom/dateTo are provided)
 * - `fetchPprDawnRiderIds` — riders passing through PPR within 10 min of 6 AM
 * - `fetchRiderGrowthData` — monthly ride counts per rider (for growth chart)
 * - `fetchRouteSpeedLeaderboard` — speed rankings per route category
 * - `fetchCommunityBreakdown` — aggregate SF2G vs other distance/elevation
 */
import { createServerFn } from '@tanstack/react-start'
import { createAnonClient } from '../lib/supabase'
import type { LeaderboardEntry, MonthlyRideStat, RouteCategory, RouteSpeedEntry, PprDawnRide, DestinationCompany } from '../lib/database.types'
import { decodePolyline } from '../lib/polyline'
import { PPR_COORDS } from '../lib/constants'

// ---------------------------------------------------------------------------
// Route-category allow-list (mirrors rides.ts)
// ---------------------------------------------------------------------------
const VALID_ROUTE_CATEGORIES = new Set([
  'bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other',
])

// ---------------------------------------------------------------------------
// Column allow-list for sort validation
// ---------------------------------------------------------------------------
const VALID_LEADERBOARD_SORT_COLUMNS = new Set([
  'sf2g_total', 'total_rides', 'avg_speed_mps',
  'bayway_count', 'skyline_count', 'hmbw_count', 'royale_count',
  'fleaway_count', 'mebw_count', 'febw_count', 'other_count',
  'sf2g_distance_meters', 'sf2g_elevation_meters',
  'total_distance_meters', 'total_elevation_meters',
  'active_years', 'last_ride_date', 'first_ride_date',
  'display_name',
])

/** Validate ISO date string format (YYYY-MM-DD) */
function isValidDateString(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str))
}

// ---------------------------------------------------------------------------
// fetchLeaderboard — reads from the materialized view (fast path) or
// queries the rides table via RPC when date filters are active.
// ---------------------------------------------------------------------------
export const fetchLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      sortBy?: string
      sortDir?: 'asc' | 'desc'
      dateFrom?: string // ISO date string e.g. '2024-01-01'
      dateTo?: string   // ISO date string
    }) => input,
  )
  .handler(async ({ data }): Promise<LeaderboardEntry[]> => {
    const supabase = createAnonClient()

    // Validated sort params (shared by both paths)
    const sortColumn = data.sortBy && VALID_LEADERBOARD_SORT_COLUMNS.has(data.sortBy)
      ? data.sortBy
      : 'sf2g_total'
    const ascending = (data.sortDir ?? 'desc') === 'asc'

    // Validate date params if provided
    const dateFrom = data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null
    const dateTo = data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null

    // ----- Date-filtered path: query rides table via RPC -----
    if (dateFrom || dateTo) {
      const { data: rows, error } = await supabase
        .rpc('get_leaderboard_by_date_range', {
          p_date_from: dateFrom,
          p_date_to: dateTo,
        })

      if (error) {
        console.error('[leaderboard] Failed to fetch date-filtered leaderboard:', error)
        throw new Error(`Failed to fetch date-filtered leaderboard: ${error.message}`)
      }

      // Sort in JS — simple, type-safe, avoids dynamic ORDER BY in SQL
      const sorted = [...(rows ?? [])].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortColumn] ?? 0
        const bVal = (b as Record<string, unknown>)[sortColumn] ?? 0
        if (aVal < bVal) return ascending ? -1 : 1
        if (aVal > bVal) return ascending ? 1 : -1
        return 0
      })

      return sorted as LeaderboardEntry[]
    }

    // ----- Fast path: materialized view -----
    const { data: viewData, error } = await supabase
      .from('leaderboard_view')
      .select('*')
      .gt('total_rides', 0)
      .order(sortColumn, { ascending })

    if (error) {
      console.error('[leaderboard] Failed to fetch leaderboard:', error)
      throw new Error(`Failed to fetch leaderboard: ${error.message}`)
    }

    const entries = (viewData ?? []) as LeaderboardEntry[]

    // Check if the view has sf2g columns (migration 006+)
    // If not, compute them from the rides table
    const needsSf2gComputation = entries.length > 0 &&
      (entries[0].sf2g_distance_meters === undefined || entries[0].sf2g_distance_meters === null)

    if (needsSf2gComputation) {
      // Fetch SF2G aggregate per user from rides table
      const { data: sf2gAgg } = await supabase
        .from('rides')
        .select('user_id, distance_meters, elevation_gain_meters, average_speed_mps, route_category')

      if (sf2gAgg) {
        // Build per-user SF2G aggregates
        const sf2gByUser = new Map<string, { distance: number; elevation: number; speedSum: number; speedCount: number; rideCount: number }>()
        for (const ride of sf2gAgg) {
          if (ride.route_category === 'other' || ride.route_category === null) continue
          const existing = sf2gByUser.get(ride.user_id) ?? { distance: 0, elevation: 0, speedSum: 0, speedCount: 0, rideCount: 0 }
          existing.distance += ride.distance_meters ?? 0
          existing.elevation += ride.elevation_gain_meters ?? 0
          existing.rideCount += 1
          if (ride.average_speed_mps != null) {
            existing.speedSum += ride.average_speed_mps
            existing.speedCount += 1
          }
          sf2gByUser.set(ride.user_id, existing)
        }

        // Patch entries with computed values
        for (const entry of entries) {
          const agg = sf2gByUser.get(entry.user_id)
          entry.sf2g_distance_meters = agg?.distance ?? 0
          entry.sf2g_elevation_meters = agg?.elevation ?? 0
          entry.sf2g_total = agg?.rideCount ?? 0
          // avg_speed_mps should only average SF2G rides
          entry.avg_speed_mps = agg && agg.speedCount > 0
            ? agg.speedSum / agg.speedCount
            : 0
        }
      }
    }

    return entries
  })

// ---------------------------------------------------------------------------
// fetchFilteredLeaderboard — computes aggregated leaderboard from individual
// rides when compound filters (route + company + date) are active.
// ---------------------------------------------------------------------------
export const fetchFilteredLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      sortBy?: string
      sortDir?: 'asc' | 'desc'
      dateFrom?: string
      dateTo?: string
      routeCategories?: string[]
      company?: string
    }) => input,
  )
  .handler(async ({ data }): Promise<LeaderboardEntry[]> => {
    const supabase = createAnonClient()

    // Build rides query with all filters applied
    let query = supabase
      .from('rides')
      .select('user_id, route_category, destination_company, distance_meters, elevation_gain_meters, average_speed_mps, tailwind_component_ms, ride_date')
      .not('route_category', 'is', null)

    // Route filter
    if (data.routeCategories && data.routeCategories.length > 0) {
      const validCats = data.routeCategories.filter(c => VALID_ROUTE_CATEGORIES.has(c))
      if (validCats.length > 0) {
        query = query.in('route_category', validCats as RouteCategory[])
      }
    }

    // Company filter
    if (data.company && VALID_COMPANIES.has(data.company)) {
      query = query.eq('destination_company', data.company as DestinationCompany)
    }

    // Date range filters
    const dateFrom = data.dateFrom && isValidDateString(data.dateFrom) ? data.dateFrom : null
    const dateTo = data.dateTo && isValidDateString(data.dateTo) ? data.dateTo : null
    if (dateFrom) query = query.gte('ride_date', dateFrom)
    if (dateTo) query = query.lte('ride_date', dateTo)

    const { data: rides, error } = await query
    if (error) {
      console.error('[leaderboard] Failed to fetch filtered rides:', error)
      throw new Error(`Failed to fetch filtered rides: ${error.message}`)
    }

    if (!rides || rides.length === 0) return []

    // Aggregate per user
    type UserAgg = {
      sf2g_total: number
      total_rides: number
      bayway_count: number
      skyline_count: number
      hmbw_count: number
      royale_count: number
      fleaway_count: number
      mebw_count: number
      febw_count: number
      other_count: number
      sf2g_distance: number
      sf2g_elevation: number
      total_distance: number
      total_elevation: number
      speedSum: number
      speedCount: number
      tailwindSum: number
      tailwindCount: number
      years: Set<number>
      lastRideDate: string | null
      firstRideDate: string | null
    }

    const userMap = new Map<string, UserAgg>()

    for (const ride of rides) {
      let agg = userMap.get(ride.user_id)
      if (!agg) {
        agg = {
          sf2g_total: 0, total_rides: 0,
          bayway_count: 0, skyline_count: 0, hmbw_count: 0, royale_count: 0,
          fleaway_count: 0, mebw_count: 0, febw_count: 0, other_count: 0,
          sf2g_distance: 0, sf2g_elevation: 0,
          total_distance: 0, total_elevation: 0,
          speedSum: 0, speedCount: 0,
          tailwindSum: 0, tailwindCount: 0,
          years: new Set<number>(),
          lastRideDate: null, firstRideDate: null,
        }
        userMap.set(ride.user_id, agg)
      }

      const cat = ride.route_category as string | null
      agg.total_rides++
      agg.total_distance += ride.distance_meters ?? 0
      agg.total_elevation += ride.elevation_gain_meters ?? 0

      if (cat && cat !== 'other') {
        agg.sf2g_total++
        agg.sf2g_distance += ride.distance_meters ?? 0
        agg.sf2g_elevation += ride.elevation_gain_meters ?? 0

        // Count per route
        const countKey = `${cat}_count` as keyof UserAgg
        if (countKey in agg && typeof agg[countKey] === 'number') {
          (agg as unknown as Record<string, number>)[countKey]++
        }

        // Speed
        if (ride.average_speed_mps != null) {
          agg.speedSum += ride.average_speed_mps
          agg.speedCount++
        }

        // Tailwind
        if (ride.tailwind_component_ms != null) {
          agg.tailwindSum += ride.tailwind_component_ms
          agg.tailwindCount++
        }

        // Active years
        if (ride.ride_date) {
          const year = new Date(ride.ride_date).getFullYear()
          if (!isNaN(year)) agg.years.add(year)
        }
      } else if (cat === 'other') {
        agg.other_count++
      }

      // Track first/last ride dates
      if (ride.ride_date) {
        if (!agg.lastRideDate || ride.ride_date > agg.lastRideDate) {
          agg.lastRideDate = ride.ride_date
        }
        if (!agg.firstRideDate || ride.ride_date < agg.firstRideDate) {
          agg.firstRideDate = ride.ride_date
        }
      }
    }

    // Get user display info
    const userIds = [...userMap.keys()]
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, avatar_url, username')
      .in('id', userIds)

    const userInfo = new Map((users ?? []).map(u => [u.id, u]))

    // Build LeaderboardEntry array
    const entries: LeaderboardEntry[] = []
    for (const [userId, agg] of userMap) {
      const user = userInfo.get(userId)
      entries.push({
        user_id: userId,
        display_name: user?.display_name ?? null,
        avatar_url: user?.avatar_url ?? null,
        username: user?.username ?? null,
        sf2g_total: agg.sf2g_total,
        total_rides: agg.total_rides,
        bayway_count: agg.bayway_count,
        skyline_count: agg.skyline_count,
        hmbw_count: agg.hmbw_count,
        royale_count: agg.royale_count,
        fleaway_count: agg.fleaway_count,
        mebw_count: agg.mebw_count,
        febw_count: agg.febw_count,
        other_count: agg.other_count,
        avg_speed_mps: agg.speedCount > 0 ? agg.speedSum / agg.speedCount : 0,
        sf2g_distance_meters: agg.sf2g_distance,
        sf2g_elevation_meters: agg.sf2g_elevation,
        total_distance_meters: agg.total_distance,
        total_elevation_meters: agg.total_elevation,
        active_years: agg.years.size,
        last_ride_date: agg.lastRideDate,
        first_ride_date: agg.firstRideDate,
        avg_tailwind_ms: agg.tailwindCount > 0 ? agg.tailwindSum / agg.tailwindCount : 0,
      })
    }

    // Sort
    const sortColumn = data.sortBy && VALID_LEADERBOARD_SORT_COLUMNS.has(data.sortBy)
      ? data.sortBy
      : 'sf2g_total'
    const ascending = (data.sortDir ?? 'desc') === 'asc'

    entries.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortColumn] ?? 0
      const bVal = (b as Record<string, unknown>)[sortColumn] ?? 0
      if (aVal < bVal) return ascending ? -1 : 1
      if (aVal > bVal) return ascending ? 1 : -1
      return 0
    })

    return entries
  })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const PPR_RADIUS_METERS = 500

function estimatePprArrival(ride: PprDawnRide): Date | null {
  if (!ride.summary_polyline) return null
  const points = decodePolyline(ride.summary_polyline)
  if (points.length === 0) return null

  for (let i = 0; i < points.length; i++) {
    const [lat, lng] = points[i]
    const dist = haversineDistance(lat, lng, PPR_COORDS.lat, PPR_COORDS.lng)
    if (dist <= PPR_RADIUS_METERS) {
      const fraction = points.length > 1 ? i / (points.length - 1) : 0
      const movingTimeMs = (ride.moving_time_seconds ?? 0) * 1000
      const startTime = new Date(ride.start_date).getTime()
      return new Date(startTime + fraction * movingTimeMs)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// fetchPprDawnRiderIds — riders who pass through PPR within 10 min of 6:00 AM
// ---------------------------------------------------------------------------
export const fetchPprDawnRiderIds = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    const supabase = createAnonClient()
    const { data: rides, error } = await supabase
      .from('ppr_dawn_rides')
      .select('*')

    if (error) {
      console.error('[leaderboard] Failed to fetch PPR dawn rides:', error)
      throw new Error(`Failed to fetch PPR dawn rides: ${error.message}`)
    }
    if (!rides || rides.length === 0) return []

    const qualifyingUserIds = new Set<string>()

    for (const ride of rides) {
      const pprTime = estimatePprArrival(ride as PprDawnRide)
      if (!pprTime) continue

      // Estimate local time using the ride's timezone offset
      const startDate = new Date(ride.start_date)
      const offsetMs = startDate.getTimezoneOffset() * 60 * 1000
      const localPprTime = new Date(pprTime.getTime() - offsetMs)
      const localMinutes = localPprTime.getUTCHours() * 60 + localPprTime.getUTCMinutes()

      // 6:00 AM = 360 min. Within 10 min = [350, 370]
      if (localMinutes >= 350 && localMinutes <= 370) {
        qualifyingUserIds.add(ride.user_id)
      }
    }

    return Array.from(qualifyingUserIds)
  }
)

// ---------------------------------------------------------------------------
// fetchRiderGrowthData — monthly ride counts per rider for growth chart
// ---------------------------------------------------------------------------
export const fetchRiderGrowthData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MonthlyRideStat[]> => {
    const supabase = createAnonClient()
    const { data, error } = await supabase
      .from('monthly_ride_stats')
      .select('user_id, month, route_category, ride_count')
      .neq('route_category', 'other')
      .not('route_category', 'is', null)
      .order('month', { ascending: true })
    if (error) {
      console.error('[leaderboard] Failed to fetch growth data:', error)
      throw new Error(`Failed to fetch growth data: ${error.message}`)
    }
    return (data ?? []) as MonthlyRideStat[]
  }
)

// ---------------------------------------------------------------------------
// fetchRouteSpeedLeaderboard — speed rankings per route category
// ---------------------------------------------------------------------------
export const fetchRouteSpeedLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator((input: { routeCategory: string }) => {
    const valid = ['bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw']
    if (!valid.includes(input.routeCategory)) {
      throw new Error(`Invalid route category: ${input.routeCategory}`)
    }
    return input as { routeCategory: RouteCategory }
  })
  .handler(async ({ data }): Promise<RouteSpeedEntry[]> => {
    const supabase = createAnonClient()
    const { data: entries, error } = await supabase
      .from('route_speed_leaderboard')
      .select('*')
      .eq('route_category', data.routeCategory)
      .order('avg_speed_mps', { ascending: false })
    if (error) {
      console.error('[leaderboard] Failed to fetch route speed leaderboard:', error)
      throw new Error(`Failed to fetch route speed leaderboard: ${error.message}`)
    }
    return (entries ?? []) as RouteSpeedEntry[]
  })

// ---------------------------------------------------------------------------
// fetchCommunityBreakdown — aggregate SF2G vs non-SF2G distance + elevation
// ---------------------------------------------------------------------------

export interface CommunityBreakdown {
  sf2g_distance_meters: number
  other_distance_meters: number
  total_distance_meters: number
  sf2g_elevation_meters: number
  other_elevation_meters: number
  total_elevation_meters: number
  sf2g_ride_count: number
  other_ride_count: number
  total_ride_count: number
}

export const fetchCommunityBreakdown = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CommunityBreakdown> => {
    const supabase = createAnonClient()

    // Fetch SF2G commute totals (bayway + skyline + hmbw + royale)
    const { data: sf2gData, error: sf2gError } = await supabase
      .from('rides')
      .select('distance_meters, elevation_gain_meters')
      .in('route_category', ['bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw'])

    if (sf2gError) {
      console.error('[leaderboard] Failed to fetch SF2G rides:', sf2gError)
      throw new Error(`Failed to fetch SF2G rides: ${sf2gError.message}`)
    }

    // Fetch "other" ride totals
    const { data: otherData, error: otherError } = await supabase
      .from('rides')
      .select('distance_meters, elevation_gain_meters')
      .eq('route_category', 'other')

    if (otherError) {
      console.error('[leaderboard] Failed to fetch other rides:', otherError)
      throw new Error(`Failed to fetch other rides: ${otherError.message}`)
    }

    const sf2gRides = sf2gData ?? []
    const otherRides = otherData ?? []

    const sf2gDistance = sf2gRides.reduce((sum, r) => sum + (r.distance_meters ?? 0), 0)
    const sf2gElevation = sf2gRides.reduce((sum, r) => sum + (r.elevation_gain_meters ?? 0), 0)
    const otherDistance = otherRides.reduce((sum, r) => sum + (r.distance_meters ?? 0), 0)
    const otherElevation = otherRides.reduce((sum, r) => sum + (r.elevation_gain_meters ?? 0), 0)

    return {
      sf2g_distance_meters: sf2gDistance,
      other_distance_meters: otherDistance,
      total_distance_meters: sf2gDistance + otherDistance,
      sf2g_elevation_meters: sf2gElevation,
      other_elevation_meters: otherElevation,
      total_elevation_meters: sf2gElevation + otherElevation,
      sf2g_ride_count: sf2gRides.length,
      other_ride_count: otherRides.length,
      total_ride_count: sf2gRides.length + otherRides.length,
    }
  },
)

// ---------------------------------------------------------------------------
// fetchCompanyRiderIds — rider IDs who have rides ending at a specific company
// ---------------------------------------------------------------------------
const VALID_COMPANIES = new Set(['netflix', 'google', 'apple', 'meta', 'nvidia', 'stanford'])

export const fetchCompanyRiderIds = createServerFn({ method: 'GET' })
  .inputValidator((input: { company: string }) => {
    if (!VALID_COMPANIES.has(input.company)) {
      throw new Error(`Invalid company: ${input.company}`)
    }
    return input
  })
  .handler(async ({ data }): Promise<string[]> => {
    const supabase = createAnonClient()

    // Query rides table directly for distinct user_ids with this destination_company
    const { data: rows, error } = await supabase
      .from('rides')
      .select('user_id')
      .eq('destination_company', data.company as DestinationCompany)
      .not('route_category', 'is', null)

    if (error) {
      console.error('[leaderboard] Failed to fetch company rider IDs:', error)
      throw new Error(`Failed to fetch company rider IDs: ${error.message}`)
    }

    // Deduplicate user IDs
    const uniqueIds = new Set((rows ?? []).map((r: { user_id: string }) => r.user_id))
    return Array.from(uniqueIds)
  })

