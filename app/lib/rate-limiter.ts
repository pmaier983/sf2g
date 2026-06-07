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
  // Check both the general rate limit and read-specific rate limit headers
  const generalUsage = headers.get('X-RateLimit-Usage')
  const readUsage = headers.get('X-ReadRateLimit-Usage')

  for (const usage of [generalUsage, readUsage]) {
    if (!usage) continue
    const parts = usage.split(',')
    if (parts.length < 2) continue
    const short = parseInt(parts[0], 10)
    const daily = parseInt(parts[1], 10)
    if (isNaN(short) || isNaN(daily)) continue
    if (
      short >= LIMIT_15MIN * SAFETY_MARGIN ||
      daily >= LIMIT_DAILY * SAFETY_MARGIN
    ) {
      return true
    }
  }

  return false
}

/**
 * Augmented response type that includes a rate limit warning flag.
 */
export interface RateLimitedResponse extends Response {
  __approachingRateLimit?: boolean
}

/**
 * Fetch from Strava API with rate limit awareness.
 *
 * - Reads `X-RateLimit-Usage` from responses
 * - Retries on HTTP 429 with exponential backoff
 * - Attaches `__approachingRateLimit` flag if nearing limits
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
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (res.status === 429) {
      console.error('[rate-limit] Strava returned 429, retry', attempt + 1, 'of', maxRetries)
      // Exponential backoff: 2s, 4s, 8s (capped at 10s)
      const backoffMs = Math.min(Math.pow(2, attempt) * 2_000, 10_000)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      continue
    }

    // Check if we're approaching limits — attach flag for the sync pipeline
    const rateLimitedRes = res as RateLimitedResponse
    if (isApproachingLimit(res.headers)) {
      rateLimitedRes.__approachingRateLimit = true
    }

    return rateLimitedRes
  }

  console.error('[rate-limit] Exhausted retries for', url)
  throw new Error(
    `Strava API: Rate limited after ${maxRetries} retries for ${url}`,
  )
}
