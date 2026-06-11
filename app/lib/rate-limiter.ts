/**
 * Stateless rate limiter for Strava API calls.
 *
 * Cloudflare Workers are ephemeral — in-memory state resets between requests.
 * Instead, we rely on Strava's `X-RateLimit-Usage` response headers and `429` status codes.
 *
 * NO module-level mutable state. Each function call is self-contained.
 */

import { STRAVA_RATE_LIMIT } from './constants'

const { LIMIT_15MIN, LIMIT_DAILY, SAFETY_MARGIN } = STRAVA_RATE_LIMIT

// ---------------------------------------------------------------------------
// Rate limit info types
// ---------------------------------------------------------------------------

export interface RateLimitInfo {
  /** Which limit was hit or is being approached */
  limitType: '15min' | 'daily'
  /** Current usage count */
  usage: number
  /** Maximum allowed */
  limit: number
  /** ISO timestamp when the limit resets */
  resetsAt: string
  /** Human-readable description of when it resets */
  resetsIn: string
}

/**
 * Custom error thrown when Strava rate limits are hit.
 * Carries structured info so the UI can display a helpful message.
 */
export class RateLimitError extends Error {
  public readonly rateLimitInfo: RateLimitInfo

  constructor(info: RateLimitInfo) {
    const resetDate = new Date(info.resetsAt)
    const resetTimeStr = resetDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
    super(
      `RATE_LIMITED:Strava's API rate limit has been reached ` +
      `(${info.usage}/${info.limit} requests in the ${info.limitType === '15min' ? 'last 15 minutes' : 'last 24 hours'}). ` +
      `The limit resets at ${resetTimeStr} (${info.resetsIn}). Please try again then.`,
    )
    this.name = 'RateLimitError'
    this.rateLimitInfo = info
  }
}

// ---------------------------------------------------------------------------
// Header parsing helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next 15-minute window boundary from now.
 * Strava's 15-minute rate limit resets on the quarter-hour (0, 15, 30, 45).
 */
function getNext15MinReset(): Date {
  const now = new Date()
  const minutes = now.getUTCMinutes()
  const nextQuarter = Math.ceil((minutes + 1) / 15) * 15
  const reset = new Date(now)
  reset.setUTCMinutes(nextQuarter, 0, 0)
  if (nextQuarter >= 60) {
    reset.setUTCMinutes(0, 0, 0)
    reset.setUTCHours(reset.getUTCHours() + 1)
  }
  return reset
}

/**
 * Compute the next daily reset (midnight UTC).
 */
function getNextDailyReset(): Date {
  const now = new Date()
  const reset = new Date(now)
  reset.setUTCDate(reset.getUTCDate() + 1)
  reset.setUTCHours(0, 0, 0, 0)
  return reset
}

/**
 * Format a time difference as a human-readable string like "12 minutes" or "3 hours".
 */
function formatTimeUntil(resetDate: Date): string {
  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return 'momentarily'
  const diffMinutes = Math.ceil(diffMs / 60_000)
  if (diffMinutes <= 1) return 'about 1 minute'
  if (diffMinutes < 60) return `about ${diffMinutes} minutes`
  const diffHours = Math.ceil(diffMinutes / 60)
  if (diffHours === 1) return 'about 1 hour'
  return `about ${diffHours} hours`
}

/**
 * Parse Strava rate limit headers and return info about which limit is closest
 * to being exceeded, or null if headers are missing/usage is low.
 */
function parseRateLimitHeaders(headers: Headers): {
  shortUsage: number
  dailyUsage: number
  isShortExceeded: boolean
  isDailyExceeded: boolean
} | null {
  const generalUsage = headers.get('X-RateLimit-Usage')
  const readUsage = headers.get('X-ReadRateLimit-Usage')

  let maxShort = 0
  let maxDaily = 0

  for (const usage of [generalUsage, readUsage]) {
    if (!usage) continue
    const parts = usage.split(',')
    if (parts.length < 2) continue
    const short = parseInt(parts[0], 10)
    const daily = parseInt(parts[1], 10)
    if (isNaN(short) || isNaN(daily)) continue
    maxShort = Math.max(maxShort, short)
    maxDaily = Math.max(maxDaily, daily)
  }

  if (maxShort === 0 && maxDaily === 0 && !generalUsage && !readUsage) {
    return null
  }

  return {
    shortUsage: maxShort,
    dailyUsage: maxDaily,
    isShortExceeded: maxShort >= LIMIT_15MIN * SAFETY_MARGIN,
    isDailyExceeded: maxDaily >= LIMIT_DAILY * SAFETY_MARGIN,
  }
}

/**
 * Build a RateLimitInfo object from parsed usage data.
 */
function buildRateLimitInfo(parsed: NonNullable<ReturnType<typeof parseRateLimitHeaders>>): RateLimitInfo {
  // Determine which limit is the binding constraint
  if (parsed.isDailyExceeded) {
    const resetDate = getNextDailyReset()
    return {
      limitType: 'daily',
      usage: parsed.dailyUsage,
      limit: LIMIT_DAILY,
      resetsAt: resetDate.toISOString(),
      resetsIn: formatTimeUntil(resetDate),
    }
  }
  const resetDate = getNext15MinReset()
  return {
    limitType: '15min',
    usage: parsed.shortUsage,
    limit: LIMIT_15MIN,
    resetsAt: resetDate.toISOString(),
    resetsIn: formatTimeUntil(resetDate),
  }
}

/**
 * Check Strava response headers for rate limit status.
 * Returns `true` if we're approaching the limit and should stop making requests.
 *
 * Strava sends two usage headers:
 * - `X-RateLimit-Usage`: general API usage — `{15min_count},{daily_count}`
 * - `X-ReadRateLimit-Usage`: read-specific usage — same format
 *
 * Either header exceeding the safety margin triggers a stop.
 *
 * @param headers - The response headers from a Strava API call
 * @returns `true` if we're approaching the rate limit
 */
export function isApproachingLimit(headers: Headers): boolean {
  const parsed = parseRateLimitHeaders(headers)
  if (!parsed) return false
  return parsed.isShortExceeded || parsed.isDailyExceeded
}

/**
 * Extract rate limit info from response headers, if approaching/exceeding limits.
 * Returns null if usage is well within limits.
 */
export function getRateLimitInfo(headers: Headers): RateLimitInfo | null {
  const parsed = parseRateLimitHeaders(headers)
  if (!parsed) return null
  if (!parsed.isShortExceeded && !parsed.isDailyExceeded) return null
  return buildRateLimitInfo(parsed)
}

/**
 * Augmented response type that includes rate limit metadata.
 */
export interface RateLimitedResponse extends Response {
  __approachingRateLimit?: boolean
  __rateLimitInfo?: RateLimitInfo
}

/**
 * Fetch from Strava API with rate limit awareness.
 *
 * - Reads `X-RateLimit-Usage` from responses
 * - Retries on HTTP 429 with exponential backoff
 * - Attaches `__approachingRateLimit` flag and `__rateLimitInfo` if nearing limits
 * - Throws `RateLimitError` with reset time info when retries are exhausted
 *
 * STATELESS: No module-level state is modified. Safe for Cloudflare Workers.
 *
 * @param url - The Strava API URL to fetch
 * @param accessToken - The user's Strava access token
 * @param maxRetries - Maximum number of retries on 429 (default: 3)
 * @returns The fetch Response (possibly with `__approachingRateLimit` flag)
 */
export async function fetchWithRateLimit(
  url: string,
  accessToken: string,
  maxRetries = 3,
): Promise<RateLimitedResponse> {
  let lastRateLimitInfo: RateLimitInfo | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (res.status === 429) {
      // Try to extract rate limit info from the 429 response headers
      lastRateLimitInfo = getRateLimitInfo(res.headers)
      if (!lastRateLimitInfo) {
        // No headers — construct a best-guess based on the 15-min window
        const resetDate = getNext15MinReset()
        lastRateLimitInfo = {
          limitType: '15min',
          usage: LIMIT_15MIN,
          limit: LIMIT_15MIN,
          resetsAt: resetDate.toISOString(),
          resetsIn: formatTimeUntil(resetDate),
        }
      }

      console.error(
        `[rate-limit] Strava returned 429 (${lastRateLimitInfo.limitType} limit: ` +
        `${lastRateLimitInfo.usage}/${lastRateLimitInfo.limit}), ` +
        `retry ${attempt + 1} of ${maxRetries}, resets ${lastRateLimitInfo.resetsIn}`,
      )

      // Exponential backoff: 2s, 4s, 8s (capped at 10s)
      const backoffMs = Math.min(Math.pow(2, attempt) * 2_000, 10_000)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      continue
    }

    // Check if we're approaching limits — attach metadata for the sync pipeline
    const rateLimitedRes = res as RateLimitedResponse
    const rateLimitInfo = getRateLimitInfo(res.headers)
    if (rateLimitInfo) {
      rateLimitedRes.__approachingRateLimit = true
      rateLimitedRes.__rateLimitInfo = rateLimitInfo
    }

    return rateLimitedRes
  }

  // Exhausted all retries — throw a structured error with reset info
  console.error('[rate-limit] Exhausted retries for', url)
  if (lastRateLimitInfo) {
    throw new RateLimitError(lastRateLimitInfo)
  }
  // Fallback if we somehow have no rate limit info
  const resetDate = getNext15MinReset()
  throw new RateLimitError({
    limitType: '15min',
    usage: LIMIT_15MIN,
    limit: LIMIT_15MIN,
    resetsAt: resetDate.toISOString(),
    resetsIn: formatTimeUntil(resetDate),
  })
}
