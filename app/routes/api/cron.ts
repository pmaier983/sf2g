/**
 * POST /api/cron?task=sync|maintenance|groups — cron entry point.
 *
 * Called by .github/workflows/cron.yml with `Authorization: Bearer CRON_SECRET`.
 * The work is AWAITED: on Cloudflare Workers a promise left running after the
 * response is returned is cancelled, which is why the previous fire-and-forget
 * version never synced anyone.
 *
 * Response (always JSON):
 * - 200 `{ ok, task, subrequests, ... }` — `ok: false` means the task ran but
 *   something failed; the workflow treats that as a failure.
 * - 400 unknown task, 401 bad secret, 500 not configured / crashed.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  runGroupRides,
  runMaintenance,
  syncUserBatch,
} from "../../server/cron";
import { performSync } from "../../server/sync";
import { createServiceClient } from "../../lib/supabase";
import { logPerf, trackSubrequests } from "../../lib/perf";

const TASKS = ["sync", "maintenance", "groups"] as const;
type CronTask = (typeof TASKS)[number];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runTask(task: CronTask): Promise<Record<string, unknown>> {
  switch (task) {
    case "sync": {
      const supabase = createServiceClient();
      const { result, subrequests } = await trackSubrequests((count) =>
        syncUserBatch({
          supabase,
          sync: performSync,
          subrequests: count,
          now: Date.now,
        }),
      );
      return { ok: result.failed === 0, subrequests, ...result };
    }
    case "maintenance": {
      const { result, subrequests } = await trackSubrequests(() =>
        runMaintenance(),
      );
      return { ok: result.errors.length === 0, subrequests, ...result };
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
    "sync") as CronTask;
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
