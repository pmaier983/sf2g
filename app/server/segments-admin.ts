/**
 * Admin actions for segment ingest (rework phase 07a), used by DevTools.
 * Each is one Supabase call; the Strava work happens later in the drain.
 */
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "../lib/admin";
import { createServiceClient } from "../lib/supabase";
import { withPerf } from "../lib/perf";

export interface SegmentIngestStats {
  rides_pending: number;
  rides_fetched: number;
  segments_total: number;
  segments_corridor: number;
  efforts: number;
  open_jobs: number;
  failed_jobs: number;
}

const MAX_BACKFILL_LIMIT = 2000;

/** Queue segment_efforts jobs for unfetched Skyline rides (opted-in riders, newest first). */
export const enqueueSegmentBackfillImpl = withPerf(
  "enqueueSegmentBackfill",
  async (input: { limit?: number }): Promise<{ enqueued: number }> => {
    const limit = Math.min(
      MAX_BACKFILL_LIMIT,
      Math.max(1, Math.floor(Number(input.limit ?? 500)) || 500),
    );
    const { data, error } = await createServiceClient().rpc(
      "enqueue_segment_backfill",
      { p_limit: limit },
    );
    if (error) throw new Error(`enqueue_segment_backfill: ${error.message}`);
    return { enqueued: data ?? 0 };
  },
);

export const fetchSegmentIngestStatsImpl = withPerf(
  "fetchSegmentIngestStats",
  async (): Promise<SegmentIngestStats> => {
    const { data, error } = await createServiceClient().rpc(
      "segment_ingest_stats",
    );
    if (error) throw new Error(`segment_ingest_stats: ${error.message}`);
    return data as unknown as SegmentIngestStats;
  },
);

export const enqueueSegmentBackfill = createServerFn({ method: "POST" })
  .inputValidator((d: { limit?: number }) => d)
  .handler(async ({ data }) => {
    await assertAdmin();
    return enqueueSegmentBackfillImpl(data);
  });

export const fetchSegmentIngestStats = createServerFn({
  method: "GET",
}).handler(async () => {
  await assertAdmin();
  return fetchSegmentIngestStatsImpl();
});
