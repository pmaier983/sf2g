/**
 * Quick debug script to check ride counts per user in the database.
 * Run with: npx tsx app/scripts/debug-rides.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
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

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  // 1. Get all users
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('id, display_name, username, strava_id, last_sync_at, last_activity_at')

  if (usersErr) {
    console.error('Error fetching users:', usersErr)
    return
  }

  console.log(`\n=== ${users?.length ?? 0} USERS ===\n`)

  for (const user of users ?? []) {
    // Count total rides
    const { count: totalRides } = await supabase
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    // Count classified rides (non-null route_category)
    const { count: classifiedRides } = await supabase
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('route_category', 'is', null)

    // Get route breakdown
    const { data: routeBreakdown } = await supabase
      .from('rides')
      .select('route_category')
      .eq('user_id', user.id)

    const routeCounts = new Map<string, number>()
    for (const ride of routeBreakdown ?? []) {
      const cat = ride.route_category ?? 'null'
      routeCounts.set(cat, (routeCounts.get(cat) ?? 0) + 1)
    }

    const routeStr = Array.from(routeCounts.entries())
      .map(([cat, count]) => `${cat}=${count}`)
      .join(', ')

    console.log(
      `${user.display_name ?? user.username ?? 'Unknown'} (${user.id.slice(0, 8)}...)` +
      `\n  strava_id: ${user.strava_id}` +
      `\n  last_sync_at: ${user.last_sync_at ?? 'never'}` +
      `\n  last_activity_at: ${user.last_activity_at ?? 'never'}` +
      `\n  total rides: ${totalRides ?? 0}` +
      `\n  classified rides: ${classifiedRides ?? 0}` +
      `\n  route breakdown: ${routeStr || 'none'}` +
      `\n`
    )
  }

  // 2. Check what the rides leaderboard query would return (default: non-null route_category)
  const { data: allRides, count: allCount } = await supabase
    .from('rides')
    .select('user_id, route_category', { count: 'exact' })
    .not('route_category', 'is', null)
    .limit(1000)

  const userIdCounts = new Map<string, number>()
  for (const r of allRides ?? []) {
    userIdCounts.set(r.user_id, (userIdCounts.get(r.user_id) ?? 0) + 1)
  }

  console.log(`\n=== RIDES LEADERBOARD QUERY (route_category IS NOT NULL) ===`)
  console.log(`Total rides: ${allCount}`)
  console.log(`Users with rides:`)
  for (const [uid, count] of userIdCounts.entries()) {
    const user = users?.find(u => u.id === uid)
    console.log(`  ${user?.display_name ?? uid}: ${count} rides`)
  }
}

main().catch(console.error)
