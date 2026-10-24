/**
 * POST /api/cron?task=drain|maintenance|groups — admin entry point
 * (`Authorization: Bearer CRON_SECRET`).
 *
 * Scheduled syncing runs from the Cloudflare Cron Trigger (app/ssr.tsx); this
 * endpoint runs the same tick on demand. `sync` is kept as an alias of
 * `drain` for old callers. The work is AWAITED: on Cloudflare Workers a promise left running after the
 * response is returned is cancelled, which is why the previous fire-and-forget
 * version never synced anyone.
 *
 * Response (always JSON):
 * - 200 `{ ok, task, ... }` — `ok: false` means the task ran but something
 *   failed.
 * - 400 unknown task, 401 bad secret, 500 not configured / crashed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { runGroupRides, runMaintenance } from "../../server/cron";
import { runScheduledTick } from "../../server/scheduled";
import { logPerf, trackSubrequests } from "../../lib/perf";

const TASKS = ["sync", "maintenance", "groups", "drain"] as const;
type CronTask = (typeof TASKS)[number];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runTask(task: CronTask): Promise<Record<string, unknown>> {
  switch (task) {
    case "maintenance": {
      const { result, subrequests } = await trackSubrequests(() =>
        runMaintenance(),
      );
      return { ok: result.errors.length === 0, subrequests, ...result };
    }
    case "sync":
    case "drain": {
      // Same as one Cron Trigger tick (useful by hand and in local dev).
      const startedAt = Date.now();
      const result = await runScheduledTick("api");
      return { ok: result.failed === 0, ms: Date.now() - startedAt, ...result };
    }
    case "groups": {
      const { result, subrequests } = await trackSubrequests(() =>
        runGroupRides(),
      );
      return { ...result, subrequests };
    }
  }
}

export async function handleCronRequest(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron] CRON_SECRET not configured");
    return json({ ok: false, error: "Cron endpoint not configured" }, 500);
  }

  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== cronSecret) {
    console.warn("[api/cron] Unauthorized cron attempt");
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const task = (new URL(request.url).searchParams.get("task") ??
    "drain") as CronTask;
  if (!TASKS.includes(task)) {
    return json({ ok: false, error: `Unknown task: ${task}` }, 400);
  }

  const startedAt = Date.now();
  try {
    const body = await runTask(task);
    logPerf(`cron:${task}`, Number(body.subrequests ?? 0), startedAt);
    return json({ task, ...body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/cron] ${task} crashed: ${message}`);
    return json({ ok: false, task, error: message }, 500);
  }
}

export const Route = createFileRoute("/api/cron")({
  server: {
    handlers: {
      POST: ({ request }) => handleCronRequest(request),
    },
  },
});
