/**
 * /api/cron request handler — extracted from the TanStack route.
 *
 * Lives at the SSR entry level (ssr.tsx) so it has access to Cloudflare's
 * ExecutionContext.waitUntil(). This lets us:
 *   1. Validate the CRON_SECRET bearer token
 *   2. Respond immediately with 202 Accepted
 *   3. Run cron jobs in the background via waitUntil()
 *
 * This prevents GitHub Actions curl from timing out (exit code 28) when
 * cron jobs take longer than the curl --max-time threshold.
 *
 * Authentication: Requires a Bearer token matching the CRON_SECRET env var.
 * This prevents unauthorized users from triggering expensive sync operations.
 *
 * TODO(security): Rate-limit this endpoint to prevent abuse.
 */
import { runCronJobs } from "./cron";

interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Handle a POST /api/cron request.
 *
 * If a Cloudflare ExecutionContext is available, responds with 202 Accepted
 * immediately and runs the cron jobs in the background via `waitUntil()`.
 * Otherwise (e.g. local dev), runs synchronously and returns 200 with results.
 */
export async function handleCronRequest(
  request: Request,
  ctx?: CloudflareExecutionContext,
): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────
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

  // ── Execute ───────────────────────────────────────────────────────────
  console.log("[api/cron] Cron triggered via API");

  if (ctx) {
    // Cloudflare production: fire-and-forget via waitUntil().
    // The response is sent immediately; the worker stays alive for the cron work.
    ctx.waitUntil(
      runCronJobs()
        .then((result) => {
          console.log(
            `[api/cron] Background cron complete: ${result.syncAll.synced} synced, ${result.syncAll.failed} failed in ${Math.round(result.totalDurationMs / 1000)}s`,
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[api/cron] Background cron failed:", message);
        }),
    );

    return new Response(
      JSON.stringify({
        status: "accepted",
        message: "Cron jobs started in background",
      }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    );
  }

  // Local dev / non-Cloudflare: run synchronously and return results
  try {
    const result = await runCronJobs();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/cron] Cron failed:", message);
    return new Response(
      JSON.stringify({ error: "Cron execution failed", message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
