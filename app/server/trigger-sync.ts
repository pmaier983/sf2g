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
import { performSync } from './sync'

/**
 * Trigger a ride sync for the currently authenticated user.
 * Returns the sync result with counts of new rides, total processed, and errors.
 */
export const triggerSync = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await getSessionData()
    if (!session) {
      throw new Error('Not authenticated')
    }

    return performSync(session.userId)
  },
)
