/**
 * Re-sync all users who have 0 rides (failed initial sync).
 * Run with: npx tsx app/scripts/resync-empty-users.ts
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

const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

async function refreshToken(userId: string, refreshToken: string): Promise<string> {
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET

  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Token refresh failed (${resp.status}): ${text}`)
  }

  const data = await resp.json() as {
    access_token: string
    refresh_token: string
    expires_at: number
  }

  // Update tokens in DB
  await supabase
    .from('users')
    .update({
      strava_access_token: data.access_token,
      strava_refresh_token: data.refresh_token,
      strava_token_expires_at: new Date(data.expires_at * 1000).toISOString(),
    })
    .eq('id', userId)

  return data.access_token
}

async function main() {
  // Get users with 0 rides
  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, strava_access_token, strava_refresh_token, strava_token_expires_at')

  const emptyUsers = []
  for (const user of users ?? []) {
    const { count } = await supabase
      .from('rides')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (count === 0) {
      emptyUsers.push(user)
    }
  }

  console.log(`Found ${emptyUsers.length} users with 0 rides\n`)

  for (const user of emptyUsers) {
    console.log(`\n--- Syncing: ${user.display_name} ---`)

    // Get a valid access token
    let accessToken = user.strava_access_token
    const expiresAt = user.strava_token_expires_at
      ? new Date(user.strava_token_expires_at).getTime()
      : 0

    if (Date.now() >= expiresAt - 60000) {
      console.log('  Token expired, refreshing...')
      try {
        accessToken = await refreshToken(user.id, user.strava_refresh_token!)
        console.log('  Token refreshed successfully')
      } catch (err) {
        console.error(`  Token refresh failed: ${err}`)
        continue
      }
    }

    // Try fetching activities
    try {
      const url = `${STRAVA_API_BASE}/athlete/activities?per_page=5&page=1`
      console.log(`  Fetching: ${url}`)

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      console.log(`  Response status: ${resp.status}`)

      if (!resp.ok) {
        const text = await resp.text()
        console.error(`  Strava API error: ${text}`)
        continue
      }

      const activities = await resp.json() as Array<{
        id: number
        type: string
        name: string
        manual: boolean
      }>
      console.log(`  Got ${activities.length} activities`)
      for (const a of activities.slice(0, 5)) {
        console.log(`    - [${a.type}${a.manual ? ' MANUAL' : ''}] ${a.name} (id: ${a.id})`)
      }

      if (activities.length > 0) {
        console.log(`\n  ✅ Strava API is working for this user! Run a full sync via the app.`)
      } else {
        console.log(`\n  ⚠️  Strava returned 0 activities — user may not have any rides.`)
      }
    } catch (err) {
      console.error(`  Fetch error: ${err}`)
    }
  }
}

main().catch(console.error)
