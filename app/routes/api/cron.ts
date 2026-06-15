/**
 * /api/cron — Server-only API route for triggering cron jobs.
 *
 * This route is called by:
 * - GitHub Actions on a schedule (every hour)
 * - Manual triggers via workflow_dispatch
 *
 * Authentication: Requires a Bearer token matching the CRON_SECRET env var.
 * This prevents unauthorized users from triggering expensive sync operations.
 *
 * The handler responds with 202 Accepted immediately and runs cron jobs
 * in the background via an unawaited promise. Cloudflare Workers keep the
 * isolate alive while I/O (Supabase, Strava API calls) is in-flight, so
 * the background work completes even though the response was already sent.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runCronJobs } from "../../server/cron";

export const Route = createFileRoute("/api/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Validate CRON_SECRET
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret) {
          console.error("[api/cron] CRON_SECRET not configured");
          return new Response(
            JSON.stringify({ error: "Cron endpoint not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");

        if (token !== cronSecret) {
          console.warn("[api/cron] Unauthorized cron attempt");
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        console.log(
          "[api/cron] Cron triggered via API — starting background execution",
        );

        // Fire-and-forget: start cron jobs without awaiting.
        // Cloudflare Workers keep the isolate alive while I/O is in-flight,
        // so this will continue executing after the response is sent.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        runCronJobs()
          .then((result) => {
            console.log(
              `[api/cron] Background cron complete: ${result.syncAll.synced} synced, ` +
                `${result.syncAll.failed} failed in ${Math.round(result.totalDurationMs / 1000)}s`,
            );
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[api/cron] Background cron failed:", message);
          });

        // Respond immediately — cron work continues in background
        return new Response(
          JSON.stringify({
            status: "accepted",
            message: "Cron jobs started in background",
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
