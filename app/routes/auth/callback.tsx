import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { handleStravaCallback } from '../../server/auth'
import { triggerSync } from '../../server/trigger-sync'
import { toast } from '../../components/Toast'

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'auth' | 'syncing' | 'done'>('auth')

  useEffect(() => {
    let cancelled = false

    async function processCallback() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const scope = params.get('scope')
        const state = params.get('state')

        // Check for Strava error response
        const stravaError = params.get('error')
        if (stravaError) {
          throw new Error(
            stravaError === 'access_denied'
              ? 'You denied access to your Strava account.'
              : `Strava error: ${stravaError}`,
          )
        }

        if (!code) {
          throw new Error('Missing authorization code from Strava.')
        }

        const result = await handleStravaCallback({
          data: {
            code,
            scope: scope ?? '',
            state: state ?? '',
          },
        })

        // Auto-sync rides after first login
        if (!cancelled) {
          setPhase('syncing')
          try {
            const syncResult = await triggerSync()

            // Surface sync results via toasts
            if (syncResult.errors.length > 0) {
              console.warn('[callback] Sync completed with errors:', syncResult.errors)
              if (syncResult.totalProcessed === 0) {
                toast.error('Could not sync rides', {
                  description: 'Strava may be experiencing issues. You can retry from the leaderboard.',
                  duration: 8000,
                })
              } else {
                toast.warning(`Synced ${syncResult.newRides} rides with warnings`, {
                  description: `${syncResult.errors.length} error(s) occurred. You can re-sync from the leaderboard.`,
                })
              }
            } else if (syncResult.newRides > 0) {
              toast.success(`Synced ${syncResult.newRides} rides from Strava!`)
            }
          } catch (syncErr) {
            // Surface sync errors via toasts — always redirect to leaderboard
            const syncMsg = syncErr instanceof Error ? syncErr.message : 'Sync failed'
            console.error('[callback] Sync failed:', syncMsg)

            const cleanMsg = syncMsg
              .replace('SYNC_FAILED:', '')
              .replace('REAUTH_REQUIRED:', '')

            toast.error('Ride sync failed', {
              description: `${cleanMsg}. You can retry from the leaderboard.`,
              duration: 8000,
            })
          }
        }

        if (!cancelled) {
          setPhase('done')
          // Always redirect — sync errors show as dismissable toasts on the leaderboard
          if (result.redirectTo) {
            window.location.href = result.redirectTo
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Authentication failed',
          )
        }
      }
    }

    processCallback()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <div className="error-state">
          <div className="error-state__icon">⚠️</div>
          <h2 className="error-state__title">Authentication Failed</h2>
          <p className="error-state__message">{error}</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <a href="/auth/login" className="btn btn--primary">
              Try Again
            </a>
            <a href="/" className="btn btn--secondary">
              Go Home
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '80vh',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          background: 'var(--color-surface-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-8)',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
        }}
      >
        {/* Animated cycling icon */}
        <div
          style={{
            fontSize: '3rem',
            marginBottom: 'var(--space-4)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          🚴
        </div>

        {/* Phase-specific content */}
        {phase === 'auth' && (
          <>
            <h2 style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--color-text)',
              marginBottom: 'var(--space-2)',
            }}>
              Connecting to Strava
            </h2>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
            }}>
              Authorizing your account...
            </p>
          </>
        )}

        {phase === 'syncing' && (
          <>
            <h2 style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--color-text)',
              marginBottom: 'var(--space-2)',
            }}>
              Syncing Your Rides
            </h2>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
            }}>
              Importing your ride history from Strava.
            </p>
            <div
              style={{
                background: 'color-mix(in srgb, var(--color-sf2g-orange) 12%, var(--color-surface))',
                border: '1px solid color-mix(in srgb, var(--color-sf2g-orange) 30%, var(--color-border))',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-sf2g-orange)',
                fontWeight: 500,
                margin: 0,
              }}>
                ☕ This first sync may take a minute or two — hang tight!
              </p>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <h2 style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--color-text)',
              marginBottom: 'var(--space-2)',
            }}>
              All Set!
            </h2>
            <p style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
            }}>
              Redirecting to the leaderboard...
            </p>
          </>
        )}

        {/* Progress bar */}
        <div
          style={{
            marginTop: 'var(--space-5)',
            height: '4px',
            borderRadius: '2px',
            background: 'var(--color-surface-hover)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              borderRadius: '2px',
              background: 'var(--color-sf2g-orange)',
              transition: 'width 0.5s ease',
              width: phase === 'auth' ? '30%' : phase === 'syncing' ? '70%' : '100%',
              animation: phase === 'syncing' ? 'progress-pulse 2s ease-in-out infinite' : undefined,
            }}
          />
        </div>

        {/* Step indicators */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 'var(--space-6)',
            marginTop: 'var(--space-4)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span style={{ color: phase === 'auth' ? 'var(--color-sf2g-orange)' : 'var(--color-text-secondary)' }}>
            {phase !== 'auth' ? '✓' : '①'} Connect
          </span>
          <span style={{ color: phase === 'syncing' ? 'var(--color-sf2g-orange)' : phase === 'done' ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
            {phase === 'done' ? '✓' : '②'} Sync
          </span>
          <span style={{ color: phase === 'done' ? 'var(--color-sf2g-orange)' : 'var(--color-text-muted)' }}>
            ③ Ready
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes progress-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
