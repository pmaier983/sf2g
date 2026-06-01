/**
 * Test Strava /athlete endpoint (non-activities) to see if it's just activities that's broken.
 * Run: npx tsx app/scripts/test-strava-athlete.ts
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

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
    .select('display_name, strava_access_token')

  for (const u of users ?? []) {
    // Test /athlete (profile info — different endpoint than /athlete/activities)
    const r1 = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: { Authorization: `Bearer ${u.strava_access_token}` },
    })

    if (r1.ok) {
      const athlete = (await r1.json()) as { firstname: string; lastname: string }
      console.log(`${u.display_name}: /athlete ✅ ${athlete.firstname} ${athlete.lastname}`)
    } else {
      console.log(`${u.display_name}: /athlete ❌ ${r1.status} — ${(await r1.text()).slice(0, 100)}`)
    }

    // Test /athlete/activities
    const r2 = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1', {
      headers: { Authorization: `Bearer ${u.strava_access_token}` },
    })

    if (r2.ok) {
      const acts = (await r2.json()) as unknown[]
      console.log(`${u.display_name}: /athlete/activities ✅ ${acts.length} activities`)
    } else {
      console.log(`${u.display_name}: /athlete/activities ❌ ${r2.status} — ${(await r2.text()).slice(0, 100)}`)
    }

    console.log()
  }
}

main().catch(console.error)
