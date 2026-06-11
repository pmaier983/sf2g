/**
 * /api/webhook — Server-only API route for Strava webhook events.
 *
 * This route handles:
 * - GET: Strava subscription verification (challenge/response handshake)
 * - POST: Incoming webhook events (activity create/update/delete, athlete deauth)
 *
 * Strava webhook docs: https://developers.strava.com/docs/webhooks/
 *
 * Security:
 * - GET verification validates hub.verify_token against STRAVA_WEBHOOK_VERIFY_TOKEN
 * - POST events are processed for known athletes only (unknown owner_ids are ignored)
 * - Webhook payloads are validated before processing (treated as untrusted input)
 * - No secrets are logged
 *
 * TODO(security): Consider adding subscription_id validation to POST handler
 * once the subscription is created and the ID is known.
 */
import { createFileRoute } from '@tanstack/react-router'
import { processWebhookEvent, type StravaWebhookEvent } from '../../server/webhook'

export const Route = createFileRoute('/api/webhook')({
  server: {
    handlers: {
      // -----------------------------------------------------------------
      // GET — Strava subscription verification handshake
      // -----------------------------------------------------------------
      // When creating a webhook subscription, Strava sends a GET request
      // with hub.mode, hub.verify_token, and hub.challenge. We must echo
      // back the challenge value if the verify_token matches.
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const mode = url.searchParams.get('hub.mode')
        const token = url.searchParams.get('hub.verify_token')
        const challenge = url.searchParams.get('hub.challenge')

        const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN

        if (!verifyToken) {
          console.error('[webhook] STRAVA_WEBHOOK_VERIFY_TOKEN not configured')
          return new Response(
            JSON.stringify({ error: 'Webhook endpoint not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        if (mode === 'subscribe' && token === verifyToken) {
          console.log('[webhook] Subscription verification successful')
          return new Response(
            JSON.stringify({ 'hub.challenge': challenge }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        console.warn('[webhook] Subscription verification failed — invalid verify_token')
        return new Response(
          JSON.stringify({ error: 'Invalid verify token' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        )
      },

      // -----------------------------------------------------------------
      // POST — Receive and process webhook events from Strava
      // -----------------------------------------------------------------
      // Strava sends a POST with the event payload. We must respond with
      // 200 within 2 seconds. Processing happens synchronously since
      // Cloudflare Workers are request-scoped (no background processing).
      //
      // Typical processing time: ~400-800ms (well within 2s limit)
      POST: async ({ request }) => {
        try {
          const event = (await request.json()) as StravaWebhookEvent

          // Basic payload validation — treat as untrusted input
          if (
            !event ||
            typeof event.object_type !== 'string' ||
            typeof event.aspect_type !== 'string' ||
            typeof event.object_id !== 'number' ||
            typeof event.owner_id !== 'number'
          ) {
            console.warn('[webhook] Invalid event payload received')
            return new Response(
              JSON.stringify({ error: 'Invalid event payload' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } },
            )
          }

          console.log(
            `[webhook] Received: ${event.object_type}.${event.aspect_type} ` +
            `object_id=${event.object_id} owner_id=${event.owner_id}`,
          )

          const result = await processWebhookEvent(event)

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          console.error('[webhook] Unhandled error:', message)

          // Always return 200 to prevent Strava from disabling the subscription.
          // Strava interprets non-2xx responses as delivery failures and may
          // throttle or disable the subscription after repeated failures.
          return new Response(
            JSON.stringify({ error: 'Processing failed', acknowledged: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
