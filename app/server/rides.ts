/**
 * Ride server functions.
 *
 * - `fetchUserRides` — queries rides for a specific user with optional filters
 */
import { createServerFn } from '@tanstack/react-start'
import { createAnonClient } from '../lib/supabase'
import type { Ride, RouteCategory, DestinationCompany, RideLeaderboardEntry, RidesLeaderboardResponse } from '../lib/database.types'

// ---------------------------------------------------------------------------
// fetchUserRides — filtered, paginated ride query
// ---------------------------------------------------------------------------
export const fetchUserRides = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      userId: string
      limit?: number
      offset?: number
      routeCategory?: RouteCategory
    }) => input,
  )
  .handler(async ({ data }): Promise<Ride[]> => {
    const supabase = createAnonClient()
    console.log(`[rides] Fetching rides for user ${data.userId}, routeCategory: ${data.routeCategory ?? 'all'}`)

    let query = supabase
      .from('rides')
      .select('*')
      .eq('user_id', data.userId)
      .order('ride_date', { ascending: false })

    // Optional route category filter
    if (data.routeCategory) {
      query = query.eq('route_category', data.routeCategory)
    } else {
      // Default: only return SF2G rides (exclude rides with null route_category)
      query = query.not('route_category', 'is', null)
    }

    // Exclude hidden rides
    query = query.eq('is_hidden', false)

    // Pagination
    const limit = data.limit ?? 50
    const offset = data.offset ?? 0
    query = query.range(offset, offset + limit - 1)

    const { data: rides, error } = await query

    if (error) {
      console.error(`[rides] Error fetching rides for user ${data.userId}:`, error.message)
      throw new Error(`Failed to fetch rides: ${error.message}`)
    }

    console.log(`[rides] Found ${rides?.length ?? 0} rides for user ${data.userId}`)
    return rides ?? []
  })

// ---------------------------------------------------------------------------
// Allowed sort columns (allow-list to prevent arbitrary column access)
// ---------------------------------------------------------------------------
const VALID_SORT_COLUMNS = new Set([
  'ride_date',
  'average_speed_mps',
  'distance_meters',
  'elevation_gain_meters',
  'moving_time_seconds',
  'name',
  'tailwind_component_ms',
])

const VALID_ROUTE_CATEGORIES = new Set([
  'bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other',
])

/**
 * Escape special LIKE/ILIKE pattern characters to prevent pattern injection.
 * Escapes `%`, `_`, and `\` in user-supplied search strings.
 */
function sanitizeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// fetchRidesLeaderboard — cross-user rides query with filters & pagination
// ---------------------------------------------------------------------------
export const fetchRidesLeaderboard = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: {
      userId?: string
      routeCategories?: string[]
      company?: string
      search?: string
      sortBy?: string
      sortDir?: 'asc' | 'desc'
      page?: number
      pageSize?: number
      dateFrom?: string // ISO date string e.g. '2024-01-01'
      dateTo?: string   // ISO date string
      includeOther?: boolean
      excludeWeekends?: boolean
    }) => input,
  )
  .handler(async ({ data }): Promise<RidesLeaderboardResponse> => {
    const supabase = createAnonClient()

    console.log('[rides-leaderboard] Input params:', JSON.stringify(data))

    const page = Math.max(1, data.page ?? 1)
    const pageSize = Math.min(500, Math.max(1, data.pageSize ?? 200))
    const offset = (page - 1) * pageSize

    // Build query — join rides with users for display info
    // Supabase PostgREST foreign-key join syntax
    let query = supabase
      .from('rides')
      .select(
        `
        id,
        user_id,
        strava_activity_id,
        name,
        ride_date,
        route_category,
        average_speed_mps,
        distance_meters,
        elevation_gain_meters,
        moving_time_seconds,
        destination_company,
        tailwind_component_ms,
        users!inner ( display_name, avatar_url, username )
      `,
        { count: 'exact' },
      )

    // Apply filters
    if (data.userId) {
      query = query.eq('user_id', data.userId)
    }

    if (data.routeCategories && data.routeCategories.length > 0) {
      // Validate categories against allow-list
      const validCats = data.routeCategories.filter((c) =>
        VALID_ROUTE_CATEGORIES.has(c),
      )
      if (validCats.length > 0) {
        query = query.in('route_category', validCats as RouteCategory[])
      } else {
        // All provided categories were invalid — fall through to default filter
        query = query.not('route_category', 'is', null)
      }
    } else {
      // Always exclude non-SF2G rides (null route_category)
      query = query.not('route_category', 'is', null)
      // When "Other" toggle is off, also exclude rides classified as 'other'
      if (!data.includeOther) {
        query = query.neq('route_category', 'other')
      }
    }

    // Always exclude hidden rides from the leaderboard
    query = query.eq('is_hidden', false)

    if (data.company) {
      query = query.eq('destination_company', data.company as DestinationCompany)
    }

    if (data.search) {
      // Sanitize search input to prevent ILIKE pattern injection
      const sanitized = sanitizeLikePattern(data.search)
      query = query.ilike('name', `%${sanitized}%`)
    }

    // Date range filters
    if (data.dateFrom) {
      query = query.gte('ride_date', data.dateFrom)
    }
    if (data.dateTo) {
      query = query.lte('ride_date', data.dateTo)
    }

    // Apply sorting (validate column against allow-list)
    const sortColumn = data.sortBy && VALID_SORT_COLUMNS.has(data.sortBy)
      ? data.sortBy
      : 'ride_date'
    const ascending = (data.sortDir ?? 'desc') === 'asc'
    query = query
      .order(sortColumn, { ascending })
      .range(offset, offset + pageSize - 1)

    const { data: rows, error, count } = await query

    console.log(`[rides-leaderboard] Query returned ${rows?.length ?? 0} rows, total count: ${count ?? 'null'}, error: ${error?.message ?? 'none'}`)

    if (error) {
      console.error('[rides-leaderboard] Supabase error:', error)
      throw new Error(`Failed to fetch rides leaderboard: ${error.message}`)
    }

    // Debug: log unique user_ids in the result
    if (rows && rows.length > 0) {
      const userIds = new Set((rows as Record<string, unknown>[]).map(r => r.user_id as string))
      console.log(`[rides-leaderboard] Rides span ${userIds.size} unique users: ${[...userIds].join(', ')}`)
    }

    // Filter out weekend rides if excludeWeekends is true (default)
    const excludeWeekends = data.excludeWeekends ?? true
    const filteredRows = excludeWeekends
      ? (rows ?? []).filter((row: Record<string, unknown>) => {
          const day = new Date(row.ride_date as string).getUTCDay()
          return day !== 0 && day !== 6
        })
      : (rows ?? [])

    // Flatten the joined user data into each ride entry
    const rides: RideLeaderboardEntry[] = filteredRows.map((row: Record<string, unknown>) => {
      const user = row.users as { display_name: string | null; avatar_url: string | null; username: string | null } | null
      return {
        id: row.id as string,
        user_id: row.user_id as string,
        strava_activity_id: row.strava_activity_id as number,
        display_name: user?.display_name ?? null,
        avatar_url: user?.avatar_url ?? null,
        username: user?.username ?? null,
        name: row.name as string | null,
        ride_date: row.ride_date as string,
        route_category: row.route_category as RouteCategory | null,
        average_speed_mps: row.average_speed_mps as number | null,
        distance_meters: (row.distance_meters as number) ?? 0,
        elevation_gain_meters: (row.elevation_gain_meters as number) ?? 0,
        moving_time_seconds: (row.moving_time_seconds as number) ?? 0,
        destination_company: row.destination_company as RideLeaderboardEntry['destination_company'],
        tailwind_component_ms: row.tailwind_component_ms as number | null,
      }
    })

    return {
      rides,
      totalCount: excludeWeekends ? rides.length : (count ?? 0),
      page,
      pageSize,
    }
  })


// ---------------------------------------------------------------------------
// fetchCommunityStartHours — average start hour per rider for percentile comparison
// ---------------------------------------------------------------------------

export interface CommunityStartHoursResponse {
  /** Array of average start hours (fractional, e.g. 6.5 = 6:30 AM), one per rider */
  averageHours: number[]
}

export const fetchCommunityStartHours = createServerFn({ method: 'GET' })
  .handler(async (): Promise<CommunityStartHoursResponse> => {
    const supabase = createAnonClient()

    // Fetch all SF2G rides in batches (Supabase default limit is 1000)
    const PAGE_SIZE = 1000
    let allRides: { user_id: string; start_date: string }[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('rides')
        .select('user_id, start_date')
        .not('route_category', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) {
        console.error('[community-start-hours] Error:', error.message)
        throw new Error(`Failed to fetch community start hours: ${error.message}`)
      }

      if (!batch || batch.length === 0) {
        hasMore = false
      } else {
        allRides = allRides.concat(batch)
        offset += PAGE_SIZE
        if (batch.length < PAGE_SIZE) hasMore = false
      }
    }

    if (allRides.length === 0) {
      return { averageHours: [] }
    }

    // Group start hours by user, then compute average per user
    const userHours = new Map<string, number[]>()
    for (const ride of allRides) {
      const date = new Date(ride.start_date)
      const hour = date.getUTCHours() + date.getUTCMinutes() / 60
      const existing = userHours.get(ride.user_id)
      if (existing) {
        existing.push(hour)
      } else {
        userHours.set(ride.user_id, [hour])
      }
    }

    // Compute average start hour for each rider
    const averageHours: number[] = []
    for (const hours of userHours.values()) {
      const avg = hours.reduce((sum, h) => sum + h, 0) / hours.length
      averageHours.push(avg)
    }

    return { averageHours }
  })

// ---------------------------------------------------------------------------
// fetchCommunityStreaks — best weekly streak per rider for percentile comparison
// ---------------------------------------------------------------------------

export interface CommunityStreaksResponse {
  /** Array of best weekly streaks, one per rider */
  bestStreaks: number[]
}

/**
 * Compute the best streak of consecutive weeks with at least one ride.
 * Server-side version of the client-side computeWeekStreak.
 */
function computeBestWeekStreak(rideDates: string[]): number {
  if (rideDates.length === 0) return 0

  // Map each ride to its ISO week key (YYYY-WW)
  const rideWeeks = new Set<string>()
  for (const dateStr of rideDates) {
    const date = new Date(dateStr)
    const jan1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
    const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000)
    const weekNum = Math.ceil((dayOfYear + jan1.getUTCDay() + 1) / 7)
    rideWeeks.add(`${date.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`)
  }

  // Generate all weeks from first to last ride
  const sortedDates = rideDates
    .map((d) => new Date(d))
    .sort((a, b) => a.getTime() - b.getTime())
  const firstDate = sortedDates[0]
  const lastDate = sortedDates[sortedDates.length - 1]

  let best = 0
  let current = 0
  const cursor = new Date(firstDate)
  // Align to Monday
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7))

  while (cursor <= lastDate) {
    const jan1 = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1))
    const dayOfYear = Math.floor((cursor.getTime() - jan1.getTime()) / 86400000)
    const weekNum = Math.ceil((dayOfYear + jan1.getUTCDay() + 1) / 7)
    const key = `${cursor.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`

    if (rideWeeks.has(key)) {
      current++
      best = Math.max(best, current)
    } else {
      current = 0
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }

  return best
}

export const fetchCommunityStreaks = createServerFn({ method: 'GET' })
  .handler(async (): Promise<CommunityStreaksResponse> => {
    const supabase = createAnonClient()

    // Fetch all SF2G ride dates in batches
    const PAGE_SIZE = 1000
    let allRides: { user_id: string; ride_date: string }[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data: batch, error } = await supabase
        .from('rides')
        .select('user_id, ride_date')
        .not('route_category', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) {
        console.error('[community-streaks] Error:', error.message)
        throw new Error(`Failed to fetch community streaks: ${error.message}`)
      }

      if (!batch || batch.length === 0) {
        hasMore = false
      } else {
        allRides = allRides.concat(batch)
        offset += PAGE_SIZE
        if (batch.length < PAGE_SIZE) hasMore = false
      }
    }

    if (allRides.length === 0) {
      return { bestStreaks: [] }
    }

    // Group ride dates by user
    const userRideDates = new Map<string, string[]>()
    for (const ride of allRides) {
      const existing = userRideDates.get(ride.user_id)
      if (existing) {
        existing.push(ride.ride_date)
      } else {
        userRideDates.set(ride.user_id, [ride.ride_date])
      }
    }

    // Compute best weekly streak for each rider
    const bestStreaks: number[] = []
    for (const dates of userRideDates.values()) {
      bestStreaks.push(computeBestWeekStreak(dates))
    }

    return { bestStreaks }
  })
