/**
 * One Cron Trigger tick (every 5 minutes, see wrangler.jsonc):
 * 1. queue an incremental sync for riders not synced in 12 hours (cheap),
 * 2. queue KOM refreshes for corridor segments not refreshed in 7 days,
 * 3. drain the sync queue within this invocation's subrequest budget.
 * Webhook jobs are claimed first, so a new ride usually lands within one tick.
 */
import { createServiceClient } from "../lib/supabase";
import { logPerf, trackSubrequests } from "../lib/perf";
import {
  defaultDrainDeps,
  drainSyncJobs,
  type DrainResult,
} from "./sync-drain";

export async function runScheduledTick(cron = "manual"): Promise<DrainResult> {
  const startedAt = Date.now();
  const { result, subrequests } = await trackSubrequests(async (count) => {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("enqueue_due_syncs", {
      p_older_than: "12 hours",
      p_limit: 10,
    });
    if (error) console.error(`[scheduled] enqueue_due_syncs: ${error.message}`);
    const { error: xomsError } = await supabase.rpc(
      "enqueue_due_segment_xoms",
      { p_older_than: "7 days", p_limit: 5 },
    );
    if (xomsError)
      console.error(
        `[scheduled] enqueue_due_segment_xoms: ${xomsError.message}`,
      );
    return drainSyncJobs(defaultDrainDeps(count));
  });
  logPerf(`scheduled:${cron}`, subrequests, startedAt);
  console.log(
    `[scheduled] claimed=${result.claimed} done=${result.done} requeued=${result.requeued} failed=${result.failed} stop=${result.stopReason}`,
  );
  return result;
}
