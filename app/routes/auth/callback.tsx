import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { handleStravaCallback } from '../../server/auth'

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
})

function CallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'auth' | 'done'>('auth')

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

        if (!cancelled) {
          setPhase('done')
          // Redirect to leaderboard after a short delay so user sees the "All Set" message
          if (result.redirectTo) {
            setTimeout(() => {
              window.location.href = result.redirectTo!
            }, 2000)
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
    const isInsufficientScopes = error.startsWith('INSUFFICIENT_SCOPES:')
    const cleanError = error.replace('INSUFFICIENT_SCOPES:', '')

    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <div className="error-state">
          <div className="error-state__icon">{isInsufficientScopes ? '🔒' : '⚠️'}</div>
          <h2 className="error-state__title">
            {isInsufficientScopes ? 'Missing Permissions' : 'Authentication Failed'}
          </h2>
          <p className="error-state__message">
            {isInsufficientScopes ? (
              <>
                SF2G needs <strong>all permission checkboxes checked</strong> on
                the Strava authorization page to sync your rides. Please try
                again and make sure every checkbox is checked — including
                &quot;View data about your private activities&quot;.
              </>
            ) : (
              error
            )}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <a href="/auth/login" className="btn btn--primary">
              {isInsufficientScopes ? 'Try Again with All Permissions' : 'Try Again'}
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
              Your rides will sync automatically within the hour.
            </p>
            <p style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}>
              You can also sync manually from the leaderboard.
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
              width: phase === 'auth' ? '30%' : '100%',
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
          <span style={{ color: phase === 'done' ? 'var(--color-sf2g-orange)' : 'var(--color-text-muted)' }}>
            {phase === 'done' ? '✓' : '②'} Ready
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}
