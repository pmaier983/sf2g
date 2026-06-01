/**
 * Comprehensive Strava app debugging.
 * Tests: rate limits, full response headers, token introspection, and app health.
 * Run: npx tsx app/scripts/debug-strava-app.ts
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
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET

  console.log('=== STRAVA APP CONFIG ===')
  console.log(`  Client ID: ${clientId ?? 'MISSING'}`)
  console.log(`  Client Secret: ${clientSecret ? clientSecret.slice(0, 4) + '...' + clientSecret.slice(-4) : 'MISSING'}`)
  console.log()

  // 1. Try a fresh token exchange to verify the app itself works
  console.log('=== TEST 1: Token refresh (tests app credentials) ===')
  const { data: firstUser } = await supabase
    .from('users')
    .select('id, display_name, strava_refresh_token')
    .limit(1)
    .single()

  if (firstUser?.strava_refresh_token) {
    const refreshResp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: firstUser.strava_refresh_token,
        grant_type: 'refresh_token',
      }),
    })

    console.log(`  Refresh status: ${refreshResp.status}`)
    const refreshBody = await refreshResp.text()
    console.log(`  Refresh body: ${refreshBody.slice(0, 300)}`)

    // Get the fresh token
    if (refreshResp.ok) {
      const tokenData = JSON.parse(refreshBody) as {
        access_token: string
        expires_at: number
        token_type: string
      }
      console.log(`  Token type: ${tokenData.token_type}`)
      console.log(`  Expires at: ${new Date(tokenData.expires_at * 1000).toISOString()}`)
      console.log()

      // 2. Make an API call with the FRESH token — dump ALL headers
      console.log('=== TEST 2: API call with fresh token — full response ===')
      const apiResp = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json',
        },
      })

      console.log(`  Status: ${apiResp.status} ${apiResp.statusText}`)
      console.log(`  ALL Response Headers:`)
      apiResp.headers.forEach((value, key) => {
        console.log(`    ${key}: ${value}`)
      })

      const apiBody = await apiResp.text()
      console.log(`  Body: ${apiBody.slice(0, 500)}`)
      console.log()

      // 3. Try activities endpoint
      console.log('=== TEST 3: Activities endpoint with fresh token ===')
      const actResp = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json',
        },
      })

      console.log(`  Status: ${actResp.status} ${actResp.statusText}`)
      console.log(`  ALL Response Headers:`)
      actResp.headers.forEach((value, key) => {
        console.log(`    ${key}: ${value}`)
      })
      const actBody = await actResp.text()
      console.log(`  Body: ${actBody.slice(0, 500)}`)
      console.log()

      // 4. Try the token deauthorize endpoint (just to check if it's responsive)
      console.log('=== TEST 4: Check Strava API health (no-auth endpoint) ===')
      // There's no health endpoint, but we can try an unauthenticated call
      const noAuthResp = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { 'Accept': 'application/json' },
        // No auth header — should get a clean 401
      })
      console.log(`  No-auth /athlete: ${noAuthResp.status}`)
      const noAuthBody = await noAuthResp.text()
      console.log(`  Body: ${noAuthBody.slice(0, 200)}`)
    }
  }

  console.log()

  // 5. Check if our tokens are actually being stored correctly
  console.log('=== TEST 5: Token storage audit ===')
  const { data: allUsers } = await supabase
    .from('users')
    .select('display_name, strava_access_token, strava_refresh_token, strava_token_expires_at, strava_scopes')

  for (const u of allUsers ?? []) {
    const tokenLen = u.strava_access_token?.length ?? 0
    const refreshLen = u.strava_refresh_token?.length ?? 0
    const hasWeirdChars = u.strava_access_token?.includes('\n') || u.strava_access_token?.includes(' ')
    console.log(`  ${u.display_name}:`)
    console.log(`    access_token length: ${tokenLen}, refresh_token length: ${refreshLen}`)
    console.log(`    scopes: ${u.strava_scopes ?? 'none recorded'}`)
    console.log(`    expires: ${u.strava_token_expires_at}`)
    console.log(`    has whitespace/newlines in token: ${hasWeirdChars}`)
  }
}

main().catch(console.error)
