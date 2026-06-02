import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { triggerSync } from '../server/trigger-sync'
import { currentUserQueryOptions } from '../queries/user'
import { toast } from './Toast'
import { trackError } from '../lib/analytics'
import type { SyncResult } from '../server/sync'

const SESSION_KEY = 'sf2g_synced'

/**
 * SyncStatus — sync controls for logged-in users.
 * Full-width banner before sync, compact button after sync.
 */
export function SyncStatus() {
  const { data: user } = useQuery(currentUserQueryOptions())
  const queryClient = useQueryClient()

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [hasSyncedThisSession, setHasSyncedThisSession] = useState(false)

  // Check sessionStorage on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === 'true') {
        setHasSyncedThisSession(true)
      }
    } catch {
      // sessionStorage may not be available in SSR
    }
  }, [])

  if (!user) return null

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncResult(null)

    try {
      const result = await triggerSync()
      setSyncResult(result)

      // Check if sync "succeeded" but had errors (e.g. Strava API issues)
      if (result.errors.length > 0) {
        console.warn('[SyncStatus] Sync completed with errors:', result.errors)
        if (result.totalProcessed === 0) {
          toast.error('Sync failed to fetch rides', {
            description: result.errors[0],
          })
          trackError('sync', result.errors[0], { userId: user.id, totalProcessed: 0 })
        } else {
          // Partial success — some rides imported but there were issues
          toast.warning(`Synced ${result.newRides} rides`, {
            description: `${result.errors.length} error(s) occurred during sync.`,
          })
          trackError('sync', `Partial sync: ${result.errors.length} error(s)`, {
            userId: user.id,
            newRides: result.newRides,
            errorCount: result.errors.length,
          })
        }
      } else if (result.newRides > 0) {
        toast.success(`Synced ${result.newRides} new rides!`)
      } else {
        toast.info('Already up to date — no new rides found.')
      }

      // Mark as synced in session
      try {
        sessionStorage.setItem(SESSION_KEY, 'true')
      } catch {
        // Ignore sessionStorage errors
      }
      setHasSyncedThisSession(true)

      // Invalidate queries to refresh data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
        queryClient.invalidateQueries({ queryKey: ['rides', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['rides-leaderboard'] }),
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'

      if (message.startsWith('REAUTH_REQUIRED:')) {
        toast.warning('Strava connection expired', {
          description: message.replace('REAUTH_REQUIRED:', ''),
          duration: Infinity,
        })
        trackError('auth', err, { userId: user.id, type: 'reauth_required' })
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = '/auth/login'
        }, 2000)
        return
      }

      // Handle SYNC_FAILED (Strava outage etc)
      const cleanMessage = message.startsWith('SYNC_FAILED:')
        ? message.replace('SYNC_FAILED:', '')
        : message

      toast.error('Ride sync failed', {
        description: cleanMessage,
      })
      trackError('sync', err, { userId: user.id })
    } finally {
      setIsSyncing(false)
    }
  }

  // Compact state — after sync this session
  if (hasSyncedThisSession && !isSyncing) {
    return (
      <div className="sync-status sync-status--compact">
        <button
          className="btn btn--secondary btn--sm"
          onClick={handleSync}
          disabled={isSyncing}
          aria-label="Sync rides from Strava"
        >
          ✓ Synced
          {syncResult && syncResult.newRides > 0 && (
            <span className="sync-status__count">
              +{syncResult.newRides}
            </span>
          )}
        </button>
      </div>
    )
  }

  // Banner state — before sync
  return (
    <div className="sync-status sync-status--banner">
      <div style={{ flex: 1 }}>
        <span className="sync-status__text">
          Last sync:{' '}
          <span className="sync-status__time">
            {user.last_sync_at
              ? new Date(user.last_sync_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : 'Never'}
          </span>
        </span>
      </div>
      <div className="sync-status__btn-group">
        <button
          className="btn btn--primary btn--sm"
          onClick={handleSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <>
              <span className="sync-status__spinner" />
              Syncing...
            </>
          ) : (
            '🔄 Sync Now'
          )}
        </button>
        <span className="sync-status__hint">
          {isSyncing
            ? 'Check all permission boxes when connecting Strava'
            : <>No rides? <a href="/auth/login" className="sync-status__hint-link">Reconnect</a> with all boxes checked</>}
        </span>
      </div>
    </div>
  )
}
