/**
 * /api/cron — Server-only API route for triggering cron jobs.
 *
 * This route is called by:
 * - GitHub Actions on a schedule (every 6 hours)
 * - Manual triggers via workflow_dispatch
 *
 * Authentication: Requires a Bearer token matching the CRON_SECRET env var.
 * This prevents unauthorized users from triggering expensive sync operations.
 */
import { createFileRoute } from '@tanstack/react-router'
import { runCronJobs } from '../../server/cron'

export const Route = createFileRoute('/api/cron')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Validate CRON_SECRET
        const cronSecret = process.env.CRON_SECRET
        if (!cronSecret) {
          console.error('[api/cron] CRON_SECRET not configured')
          return new Response(
            JSON.stringify({ error: 'Cron endpoint not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const authHeader = request.headers.get('Authorization')
        const token = authHeader?.replace('Bearer ', '')

        if (token !== cronSecret) {
          console.warn('[api/cron] Unauthorized cron attempt')
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        try {
          console.log('[api/cron] Cron triggered via API')
          const result = await runCronJobs()

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          console.error('[api/cron] Cron failed:', message)

          return new Response(
            JSON.stringify({ error: 'Cron execution failed', message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      },
    },
  },
})
