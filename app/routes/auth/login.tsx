import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getStravaAuthUrl } from '../../server/auth'

export const Route = createFileRoute('/auth/login')({
  component: LoginPage,
})

function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function redirect() {
      try {
        const url = await getStravaAuthUrl()
        if (!cancelled) {
          window.location.href = url
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to get authorization URL',
          )
        }
      }
    }

    redirect()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
        <div className="error-state">
          <div className="error-state__icon">⚠️</div>
          <h2 className="error-state__title">Login Error</h2>
          <p className="error-state__message">{error}</p>
          <a href="/auth/login" className="btn btn--primary" style={{ marginTop: 'var(--space-4)' }}>
            Try Again
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)' }}>
      <div className="loading-state">
        <div className="loading-state__spinner" />
        <p className="loading-state__text">Redirecting to Strava...</p>
      </div>
    </div>
  )
}
