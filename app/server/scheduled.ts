/**
 * One Cron Trigger tick (every 5 minutes, see wrangler.jsonc):
 * 1. queue an incremental sync for riders not synced in 12 hours (cheap),
 * 2. drain the sync queue within this invocation's subrequest budget.
 * Webhook jobs are claimed first, so a new ride usually lands within one tick.
 *
 * Failures are recorded in `app_errors` (report-error.ts): a tick that can't
 * queue work, and jobs that failed for a reason other than Strava rate
 * limiting or a rider revoking access (those are expected and already shown
 * in Sync Health).
 */
import { createServiceClient } from "../lib/supabase";
import { logPerf, trackSubrequests } from "../lib/perf";
import {
  defaultDrainDeps,
  drainSyncJobs,
  isReauthError,
  type DrainResult,
} from "./sync-drain";
import { reportError } from "./report-error";

/** At most this many job failures are recorded per tick (one insert each). */
export const JOB_ERRORS_REPORTED_PER_TICK = 2;

export async function reportJobFailures(
  result: DrainResult,
  report: typeof reportError = reportError,
): Promise<number> {
  const unexpected = result.jobs.filter(
    (j) =>
      j.status === "error" &&
      !j.detail.includes("RATE_LIMITED") &&
      !isReauthError(j.detail),
  );
  const toReport = unexpected.slice(0, JOB_ERRORS_REPORTED_PER_TICK);
  for (const job of toReport) {
    await report(`sync:${job.kind}`, new Error(job.detail), {
      jobId: job.id,
      kind: job.kind,
      unreportedInTick: unexpected.length - toReport.length,
    });
  }
  return toReport.length;
}

export async function runScheduledTick(cron = "manual"): Promise<DrainResult> {
  const startedAt = Date.now();
  const { result, subrequests } = await trackSubrequests(async (count) => {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("enqueue_due_syncs", {
      p_older_than: "12 hours",
      p_limit: 10,
    });
    if (error) {
      await reportError(
        "scheduled",
        new Error(`enqueue_due_syncs: ${error.message}`),
        { cron },
      );
    }
    const drain = await drainSyncJobs(defaultDrainDeps(count));
    await reportJobFailures(drain);
    return drain;
  });
  logPerf(`scheduled:${cron}`, subrequests, startedAt);
  console.log(
    `[scheduled] claimed=${result.claimed} done=${result.done} requeued=${result.requeued} failed=${result.failed} stop=${result.stopReason}`,
  );
  return result;
}
