/**
 * Sync queue drain — run by the Cloudflare Cron Trigger (app/ssr.tsx
 * `scheduled`) every few minutes, and by the admin cron endpoint.
 *
 * Each invocation must fit Workers Free: 50 subrequests, 10 ms CPU. The
 * drain claims a few due jobs, runs ONE step of each (one Strava page, one
 * activity, one maintenance call), and stops before the live subrequest
 * count leaves too little headroom. Jobs that have more work re-queue
 * themselves with a cursor; failures back off exponentially.
 */
import { createServiceClient } from "../lib/supabase";
import {
  backfillStep,
  performSync,
  syncSingleActivity,
  type SyncOptions,
} from "./sync";
import { cleanupDeauthorizedUser } from "./auth";
import { MATERIALIZED_VIEW_REFRESHES } from "./cron";
import type { Database } from "../lib/database.types";

type Job = Database["public"]["Tables"]["sync_jobs"]["Row"];
type ServiceClient = ReturnType<typeof createServiceClient>;

export const DRAIN_BUDGET = {
  /** Stop claiming/starting jobs above this many subrequests (cap: 50). */
  SUBREQUEST_BUDGET: 44,
  /** Headroom reserved before starting each job (worst-case job cost). */
  PER_JOB_HEADROOM: 10,
  /** Jobs claimed per invocation. */
  CLAIM: 5,
  /** Activities per Strava page for incremental/backfill steps. */
  PER_PAGE: 100,
  /** Give up on a job after this many attempts. */
  MAX_ATTEMPTS: 5,
  /** Wall-clock cap per invocation. */
  MAX_MS: 25_000,
} as const;

/** Cron-mode sync: one page per step, no per-user side work. */
const STEP_SYNC_OPTIONS: SyncOptions = {
  skipLeaderboardRefresh: true,
  skipGroupRides: true,
  skipSameDayRecheck: true,
  maxPages: 1,
  perPage: DRAIN_BUDGET.PER_PAGE,
  clearSessionOnReauth: false,
};

export type JobOutcome =
  | { status: "done"; detail: string; ridesChanged: boolean }
  | {
      status: "requeue";
      detail: string;
      cursor?: Record<string, unknown>;
      ridesChanged: boolean;
    };

export interface DrainDeps {
  supabase: ServiceClient;
  subrequests: () => number;
  now: () => number;
  run: (job: Job) => Promise<JobOutcome>;
}

export interface DrainResult {
  claimed: number;
  done: number;
  requeued: number;
  failed: number;
  needsReauth: number;
  rateLimited: boolean;
  stopReason:
    | "empty"
    | "subrequest_budget"
    | "time_budget"
    | "rate_limited"
    | "claimed_all";
  jobs: Array<{ id: number; kind: string; status: string; detail: string }>;
}

function isReauthError(message: string): boolean {
  // Only a rejected refresh token means the rider must reconnect; a Strava
  // outage (5xx) during refresh is retried like any other failure.
  return (
    message.includes("REAUTH_REQUIRED") ||
    message.includes("invalid_grant") ||
    /token refresh failed \((400|401)\)/.test(message) ||
    message.includes("Authorization Error")
  );
}

/** Minutes to wait before retry n (1, 2, 4, 8, 16). */
export function backoffMinutes(attempts: number): number {
  return 2 ** Math.max(0, attempts - 1);
}

/** Execute one step of a job. */
export async function runJob(
  job: Job,
  supabase: ServiceClient,
): Promise<JobOutcome> {
  switch (job.kind) {
    case "webhook_activity": {
      const activityId = Number(
        (job.payload as { activity_id?: number }).activity_id,
      );
      const outcome = await syncSingleActivity(job.user_id!, activityId);
      return {
        status: "done",
        detail: outcome,
        ridesChanged: outcome === "ride_upserted",
      };
    }
    case "incremental": {
      const res = await performSync(job.user_id!, STEP_SYNC_OPTIONS);
      if (res.rateLimited) {
        throw new Error("RATE_LIMITED: Strava usage near its limit");
      }
      return res.hasMore
        ? {
            status: "requeue",
            detail: `${res.newRides} rides, more pages`,
            ridesChanged: res.newRides > 0,
          }
        : {
            status: "done",
            detail: `${res.newRides} rides`,
            ridesChanged: res.newRides > 0,
          };
    }
    case "backfill": {
      const before = Number(
        (job.cursor as { before?: number }).before ??
          Math.floor(Date.now() / 1000),
      );
      const step = await backfillStep(
        job.user_id!,
        before,
        DRAIN_BUDGET.PER_PAGE,
      );
      return step.nextBefore === null
        ? {
            status: "done",
            detail: `${step.upserted} rides, history complete`,
            ridesChanged: step.upserted > 0,
          }
        : {
            status: "requeue",
            detail: `${step.upserted} rides, continuing before ${step.nextBefore}`,
            cursor: { before: step.nextBefore },
            ridesChanged: step.upserted > 0,
          };
    }
    case "deauthorize": {
      await cleanupDeauthorizedUser(job.user_id!);
      return {
        status: "done",
        detail: "rider data removed",
        ridesChanged: true,
      };
    }
    case "refresh_views": {
      for (const fn of MATERIALIZED_VIEW_REFRESHES) {
        const { error } = await supabase.rpc(fn as never);
        if (error) throw new Error(`${fn}: ${error.message}`);
      }
      return { status: "done", detail: "views refreshed", ridesChanged: false };
    }
    case "recompute_groups": {
      const { data, error } = await supabase.rpc("recompute_group_rides");
      if (error) throw new Error(`recompute_group_rides: ${error.message}`);
      return {
        status: "done",
        detail: `${data} group rides`,
        ridesChanged: false,
      };
    }
    default:
      return {
        status: "done",
        detail: `unknown kind ${job.kind}`,
        ridesChanged: false,
      };
  }
}

export async function drainSyncJobs(deps: DrainDeps): Promise<DrainResult> {
  const { supabase, subrequests, now, run } = deps;
  const started = now();
  const result: DrainResult = {
    claimed: 0,
    done: 0,
    requeued: 0,
    failed: 0,
    needsReauth: 0,
    rateLimited: false,
    stopReason: "claimed_all",
    jobs: [],
  };

  const { data: claimed, error } = await supabase.rpc("claim_sync_jobs", {
    n: DRAIN_BUDGET.CLAIM,
  });
  if (error) throw new Error(`claim_sync_jobs: ${error.message}`);
  const jobs = (claimed ?? []) as Job[];
  result.claimed = jobs.length;
  if (jobs.length === 0) {
    result.stopReason = "empty";
    return result;
  }

  let ridesChanged = false;
  const unstarted: Job[] = [];

  for (const job of jobs) {
    if (result.rateLimited) {
      unstarted.push(job);
      continue;
    }
    if (
      subrequests() + DRAIN_BUDGET.PER_JOB_HEADROOM >
      DRAIN_BUDGET.SUBREQUEST_BUDGET
    ) {
      result.stopReason = "subrequest_budget";
      unstarted.push(job);
      continue;
    }
    if (now() - started > DRAIN_BUDGET.MAX_MS) {
      result.stopReason = "time_budget";
      unstarted.push(job);
      continue;
    }

    const at = new Date(now()).toISOString();
    try {
      const outcome = await run(job);
      ridesChanged ||= outcome.ridesChanged;
      if (outcome.status === "requeue") {
        await supabase
          .from("sync_jobs")
          .update({
            status: "queued",
            run_after: at,
            locked_at: null,
            attempts: 0,
            cursor: (outcome.cursor ?? job.cursor) as never,
            last_error: null,
            updated_at: at,
          })
          .eq("id", job.id);
        result.requeued++;
      } else {
        await supabase
          .from("sync_jobs")
          .update({
            status: "done",
            finished_at: at,
            updated_at: at,
            last_error: null,
            locked_at: null,
          })
          .eq("id", job.id);
        result.done++;
      }
      result.jobs.push({
        id: job.id,
        kind: job.kind,
        status: outcome.status,
        detail: outcome.detail,
      });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(
        0,
        500,
      );
      const rateLimited = message.includes("RATE_LIMITED");
      const reauth = !rateLimited && isReauthError(message);
      const giveUp = reauth || job.attempts >= DRAIN_BUDGET.MAX_ATTEMPTS;

      if (rateLimited) {
        // Not the job's fault: retry after the 15-minute window resets.
        result.rateLimited = true;
        result.stopReason = "rate_limited";
        await supabase
          .from("sync_jobs")
          .update({
            status: "queued",
            attempts: Math.max(0, job.attempts - 1),
            run_after: new Date(now() + 15 * 60_000).toISOString(),
            locked_at: null,
            last_error: message,
            updated_at: at,
          })
          .eq("id", job.id);
        result.requeued++;
      } else {
        await supabase
          .from("sync_jobs")
          .update({
            status: giveUp ? "failed" : "queued",
            run_after: new Date(
              now() + backoffMinutes(job.attempts) * 60_000,
            ).toISOString(),
            locked_at: null,
            last_error: message,
            finished_at: giveUp ? at : null,
            updated_at: at,
          })
          .eq("id", job.id);
        if (giveUp) result.failed++;
        else result.requeued++;
      }

      if (job.user_id && !rateLimited) {
        await supabase
          .from("users")
          .update({
            last_sync_error: message,
            ...(reauth ? { needs_reauth: true } : {}),
          })
          .eq("id", job.user_id);
        if (reauth) result.needsReauth++;
      }
      result.jobs.push({
        id: job.id,
        kind: job.kind,
        status: "error",
        detail: message,
      });
    }
  }

  // Release jobs we claimed but didn't start, so the next tick picks them up.
  for (const job of unstarted) {
    await supabase
      .from("sync_jobs")
      .update({
        status: "queued",
        locked_at: null,
        attempts: Math.max(0, job.attempts - 1),
      })
      .eq("id", job.id);
  }

  // New rides → refresh views (and then group rides) once, in a later tick.
  if (ridesChanged) {
    await supabase.rpc("enqueue_sync_job", { p_kind: "refresh_views" });
  }
  if (jobs.some((j) => j.kind === "refresh_views") && result.done > 0) {
    await supabase.rpc("enqueue_sync_job", { p_kind: "recompute_groups" });
  }

  return result;
}

/** Production wiring: real Supabase client and job runner. */
export function defaultDrainDeps(subrequests: () => number): DrainDeps {
  const supabase = createServiceClient();
  return {
    supabase,
    subrequests,
    now: Date.now,
    run: (job) => runJob(job, supabase),
  };
}
