/**
 * Deep investigation of Strava API 500 errors.
 * Tests multiple endpoints and scopes to find what works.
 * Run: npx tsx app/scripts/investigate-strava-500.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
try {
  const envFile = readFileSync('.env.local', 'utf-8')
  for (const line of envFile.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0 && !process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1)
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, strava_id, strava_access_token, strava_refresh_token, strava_token_expires_at, strava_scopes')

  for (const user of users ?? []) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`${user.display_name} (strava_id: ${user.strava_id})`)
    console.log(`${'='.repeat(60)}`)
    console.log(`  Scopes: ${user.strava_scopes ?? 'NOT RECORDED'}`)
    console.log(`  Token expires: ${user.strava_token_expires_at ?? 'unknown'}`)

    const isExpired = user.strava_token_expires_at
      ? new Date(user.strava_token_expires_at).getTime() < Date.now()
      : true
    console.log(`  Token expired: ${isExpired}`)

    let token = user.strava_access_token

    // Refresh if expired
    if (isExpired && user.strava_refresh_token) {
      console.log(`  Refreshing token...`)
      try {
        const resp = await fetch('https://www.strava.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            refresh_token: user.strava_refresh_token,
            grant_type: 'refresh_token',
          }),
        })

        if (resp.ok) {
          const data = await resp.json() as { access_token: string; refresh_token: string; expires_at: number }
          token = data.access_token
          console.log(`  ✅ Token refreshed, expires: ${new Date(data.expires_at * 1000).toISOString()}`)

          // Save new tokens
          await supabase.from('users').update({
            strava_access_token: data.access_token,
            strava_refresh_token: data.refresh_token,
            strava_token_expires_at: new Date(data.expires_at * 1000).toISOString(),
          }).eq('id', user.id)
        } else {
          const text = await resp.text()
          console.log(`  ❌ Token refresh failed: ${resp.status} — ${text}`)
          continue
        }
      } catch (err) {
        console.log(`  ❌ Token refresh error: ${err}`)
        continue
      }
    }

    // Test endpoints
    const endpoints = [
      { name: '/athlete', url: 'https://www.strava.com/api/v3/athlete' },
      { name: '/athlete/activities (1)', url: 'https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1' },
      { name: '/athlete/stats', url: `https://www.strava.com/api/v3/athletes/${user.strava_id}/stats` },
    ]

    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep.url, {
          headers: { Authorization: `Bearer ${token}` },
        })

        const headers: Record<string, string> = {}
        resp.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith('x-ratelimit') || k.toLowerCase() === 'content-type') {
            headers[k] = v
          }
        })

        if (resp.ok) {
          const body = await resp.json()
          const preview = JSON.stringify(body).slice(0, 150)
          console.log(`  ${ep.name}: ✅ ${resp.status} — ${preview}...`)
        } else {
          const text = await resp.text()
          console.log(`  ${ep.name}: ❌ ${resp.status} — ${text.slice(0, 200)}`)
        }
        if (Object.keys(headers).length > 0) {
          console.log(`    Rate limit headers: ${JSON.stringify(headers)}`)
        }
      } catch (err) {
        console.log(`  ${ep.name}: ❌ NETWORK ERROR — ${err}`)
      }
    }
  }
}

main().catch(console.error)
