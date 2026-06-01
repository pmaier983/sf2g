/**
 * Test Strava API with both domain variants.
 * Run: npx tsx app/scripts/test-strava-domains.ts
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
} catch {}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing env vars')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  const { data: users } = await supabase
    .from('users')
    .select('id, display_name, strava_access_token')

  const DOMAINS = [
    'https://www.strava.com/api/v3',
    'https://www.api-v3.strava.com',
  ]

  for (const user of users ?? []) {
    console.log(`\n=== ${user.display_name} ===`)

    for (const base of DOMAINS) {
      const endpoint = `${base}/athlete/activities?per_page=2&page=1`
      try {
        const resp = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${user.strava_access_token}` },
        })
        if (resp.ok) {
          const acts = await resp.json() as unknown[]
          console.log(`  ${base}: ✅ ${resp.status} (${acts.length} activities)`)
        } else {
          const text = await resp.text()
          console.log(`  ${base}: ❌ ${resp.status} — ${text.slice(0, 100)}`)
        }
      } catch (err) {
        console.log(`  ${base}: ❌ NETWORK ERROR — ${err}`)
      }
    }
  }
}

main().catch(console.error)
