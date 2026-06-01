/**
 * Cookie-based session management for SF2G.
 *
 * Uses `@tanstack/react-start/server` for cookie operations
 * (compatible with TanStack Start's server runtime).
 * Session data is encoded as base64url JSON in an HTTP-only cookie.
 *
 * NO `Buffer` usage — uses `btoa`/`atob` with base64url conversion
 * for Cloudflare Workers compatibility.
 */
import { getCookie, setCookie, deleteCookie } from '@tanstack/react-start/server'

const SESSION_COOKIE = 'sf2g_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export interface SessionData {
  userId: string   // UUID
  stravaId: number
}

// ---------------------------------------------------------------------------
// Base64url helpers (Cloudflare Workers compatible — no Buffer)
// ---------------------------------------------------------------------------

/**
 * Encode a string to base64url (URL-safe base64 without padding).
 * Uses `btoa` which is available in all modern runtimes including Workers.
 */
function toBase64Url(str: string): string {
  const base64 = btoa(str)
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Decode a base64url string back to a regular string.
 * Uses `atob` which is available in all modern runtimes including Workers.
 */
function fromBase64Url(base64url: string): string {
  // Restore standard base64
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  // Re-add padding
  const pad = base64.length % 4
  if (pad === 2) base64 += '=='
  else if (pad === 3) base64 += '='

  return atob(base64)
}

// ---------------------------------------------------------------------------
// Session API
// ---------------------------------------------------------------------------

/**
 * Read the current session from the cookie.
 * Returns `null` if no session cookie exists or if it's invalid.
 */
export function getSessionData(): SessionData | null {
  const raw = getCookie(SESSION_COOKIE)
  if (!raw) return null

  try {
    const decoded = fromBase64Url(raw)
    const parsed = JSON.parse(decoded) as SessionData

    // Basic validation
    if (!parsed.userId || typeof parsed.stravaId !== 'number') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

/**
 * Set the session cookie with the given data.
 * Cookie is HTTP-only, secure in production, and lasts 30 days.
 */
export function setSessionData(data: SessionData): void {
  const json = JSON.stringify(data)
  const encoded = toBase64Url(json)

  setCookie(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  })
}

/**
 * Clear the session cookie (logout).
 */
export function clearSessionData(): void {
  deleteCookie(SESSION_COOKIE, {
    path: '/',
  })
}
