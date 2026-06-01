/**
 * PostHog reverse proxy handler.
 *
 * Proxies requests from `/ingest/*` to PostHog servers so analytics traffic
 * goes through the app's own domain. This prevents ad blockers from blocking
 * PostHog — they only block known third-party tracking domains.
 *
 * Routes:
 *   /ingest/static/*  →  us-assets.i.posthog.com/static/*
 *   /ingest/*         →  us.i.posthog.com/*
 */

const POSTHOG_HOST = 'https://us.i.posthog.com'
const POSTHOG_ASSETS_HOST = 'https://us-assets.i.posthog.com'

/**
 * Headers that should NOT be forwarded to/from PostHog.
 * These are hop-by-hop or security-sensitive headers.
 */
const BLOCKED_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
])

function filterHeaders(headers: Headers): Record<string, string> {
  const filtered: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value
    }
  })
  return filtered
}

export async function handlePostHogProxy(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Determine target host based on path
  let targetUrl: string
  if (pathname.startsWith('/ingest/static/')) {
    // Asset requests (JS bundles, etc.)
    targetUrl = `${POSTHOG_ASSETS_HOST}${pathname.replace('/ingest', '')}`
  } else {
    // API requests (events, decide, etc.)
    targetUrl = `${POSTHOG_HOST}${pathname.replace('/ingest', '')}`
  }

  // Preserve query string
  if (url.search) {
    targetUrl += url.search
  }

  const headers = filterHeaders(request.headers)
  // PostHog needs to know the original host for CORS
  headers['host'] = new URL(targetUrl).host

  const proxyResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
    // @ts-expect-error — Cloudflare Workers support duplex streaming
    duplex: request.method !== 'GET' && request.method !== 'HEAD'
      ? 'half'
      : undefined,
  })

  // Build response with filtered headers
  const responseHeaders = new Headers()
  proxyResponse.headers.forEach((value, key) => {
    if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })
  // Allow CORS for the app's own origin
  responseHeaders.set('access-control-allow-origin', url.origin)

  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: responseHeaders,
  })
}
