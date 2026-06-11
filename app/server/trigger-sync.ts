/**
 * Client-callable server function to trigger a ride sync.
 *
 * This file ONLY exports createServerFn functions — no raw interfaces or
 * non-serverFn exports. This is required because TanStack Start's
 * import-protection plugin can tree-shake createServerFn exports but NOT
 * regular exports. If sync.ts (which has `performSync`, `SyncResult`) is
 * imported directly from a route component, the bundler follows the full
 * import graph into session.ts → @tanstack/react-start/server, which is
 * banned in client environments.
 *
 * Route components should import from this file.
 * Server-only code (cron.ts) should import directly from sync.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSessionData } from '../lib/session'
import { createAnonClient, createServiceClient } from '../lib/supabase'
import { performSync } from './sync'

/** Maximum number of simultaneous syncs allowed globally. */
const MAX_CONCURRENT_SYNCS = 5

/** Minimum time between syncs per user (in milliseconds). */
const SYNC_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Trigger a ride sync for the currently authenticated user.
 *
 * Safety checks:
 * 1. Per-user cooldown — 5 minutes between syncs
 * 2. Global concurrency — max 5 simultaneous syncs
 *
 * Returns the sync result with counts of new rides, total processed, and errors.
 */
export const triggerSync = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    // Check sync cooldown (5 minutes)
    const supabase = createAnonClient()
    const { data: user } = await supabase
      .from('users')
      .select('last_sync_at, created_at')
      .eq('id', session.userId)
      .single()

    if (user?.last_sync_at) {
      const lastSync = new Date(user.last_sync_at)
      const elapsed = Date.now() - lastSync.getTime()

      // Skip cooldown if the only sync so far was the initial one from OAuth callback.
      // Detect this by checking if last_sync_at is within 10 minutes of account creation.
      // This lets new users immediately trigger a manual re-sync after joining.
      const createdAt = user.created_at ? new Date(user.created_at) : null
      const isFirstSyncEver =
        createdAt &&
        Math.abs(lastSync.getTime() - createdAt.getTime()) < 10 * 60 * 1000

      if (elapsed < SYNC_COOLDOWN_MS && !isFirstSyncEver) {
        const remainingMinutes = Math.ceil(
          (SYNC_COOLDOWN_MS - elapsed) / 60_000,
        )
        throw new Error(
          `SYNC_COOLDOWN:Please wait ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} before syncing again.`,
        )
      }
    }

    // Check global sync concurrency (max 5 simultaneous syncs)
    // Heuristic: users who synced within the last 3 minutes are likely still active
    const serviceClient = createServiceClient()
    const { count: activeCount } = await serviceClient
      .from('users')
      .select('id', { count: 'exact', head: true })
      .not('last_sync_at', 'is', null)
      .gte(
        'last_sync_at',
        new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      )

    if ((activeCount ?? 0) >= MAX_CONCURRENT_SYNCS) {
      throw new Error(
        'SYNC_BUSY:Too many syncs in progress. Try again in a minute.',
      )
    }

    return performSync(session.userId)
  },
)
