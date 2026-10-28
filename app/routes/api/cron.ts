/**
 * POST /api/cron?task=drain|maintenance|groups|weekly-report|monthly-report
 * — admin entry point
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
import {
  isPeriodKey,
  periodKeyFormat,
  type ReportKind,
} from "../../lib/report";

const TASKS = [
  "sync",
  "maintenance",
  "groups",
  "drain",
  "weekly-report",
  "monthly-report",
] as const;
type CronTask = (typeof TASKS)[number];

const REPORT_TASKS: Partial<Record<CronTask, ReportKind>> = {
  "weekly-report": "week",
  "monthly-report": "month",
};

/**
 * `task=weekly-report|monthly-report` options:
 * - `period=YYYY-MM-DD` (any day of the week) / `period=YYYY-MM` — report a
 *   specific period (default: the previous LA week / month)
 * - `dry=1`   — render and store, do not email
 * - `force=1` — email again even if that period was already sent
 */
function reportOptions(kind: ReportKind, url: URL) {
  const period = url.searchParams.get("period") ?? undefined;
  if (period && !isPeriodKey(kind, period)) {
    throw new Error(`period must be ${periodKeyFormat(kind)}, got ${period}`);
  }
  return {
    kind,
    period,
    send: url.searchParams.get("dry") !== "1",
    force: url.searchParams.get("force") === "1",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runTask(
  task: CronTask,
  url: URL,
): Promise<Record<string, unknown>> {
  switch (task) {
    case "weekly-report":
    case "monthly-report": {
      const { runReport, defaultReportDeps } =
        await import("../../server/report");
      const { result, subrequests } = await trackSubrequests(() =>
        runReport(reportOptions(REPORT_TASKS[task]!, url), defaultReportDeps()),
      );
      // The rendered email is large; return everything but the bodies.
      const { html: _html, text: _text, ...rest } = result;
      return {
        ok: result.status !== "send_failed",
        subrequests,
        ...rest,
      };
    }
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

  const url = new URL(request.url);
  const task = (url.searchParams.get("task") ?? "drain") as CronTask;
  if (!TASKS.includes(task)) {
    return json({ ok: false, error: `Unknown task: ${task}` }, 400);
  }

  const startedAt = Date.now();
  try {
    const body = await runTask(task, url);
    logPerf(`cron:${task}`, Number(body.subrequests ?? 0), startedAt);
    return json({ task, ...body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { reportError } = await import("../../server/report-error");
    await reportError("api/cron", err, { task, requestUrl: url.pathname });
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
