/**
 * Analytics/logging wrapper around PostHog.
 * Client-only — must not be imported directly in server-only code paths.
 */
import posthog from 'posthog-js'

let initialized = false

/** Initialize PostHog. Call once from __root.tsx useEffect. */
export function initAnalytics() {
  if (initialized || typeof window === 'undefined') return

  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST
  if (!key) return // Graceful no-op if not configured

  posthog.init(key, {
    api_host: host || 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    persistence: 'localStorage',
  })
  initialized = true
}

/** Identify the logged-in user (call after auth). */
export function identifyUser(userId: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  posthog.identify(userId, props)
}

/** Reset identity on logout. */
export function resetUser() {
  if (typeof window === 'undefined') return
  posthog.reset()
}

/** Track a custom event. */
export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  posthog.capture(event, properties)
}

/** Log an error event with structured metadata. */
export function trackError(
  category: 'strava_api' | 'sync' | 'auth' | 'client' | 'network',
  error: unknown,
  context?: Record<string, unknown>,
) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  trackEvent('error_occurred', {
    error_category: category,
    error_message: message,
    error_stack: stack,
    ...context,
  })
}

/** Set up global error handlers for uncaught errors. */
export function setupGlobalErrorHandlers() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    trackError('client', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    trackError('client', event.reason, {
      type: 'unhandled_promise_rejection',
    })
  })
}
