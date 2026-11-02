/**
 * Admin actions for segment ingest (rework phase 07a), used by DevTools.
 * Each is one Supabase call; the Strava work happens later in the drain.
 * reclassifySegmentCorridors (07c) pages through `segments`, two calls per
 * page.
 */
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "../lib/admin";
import { createServiceClient } from "../lib/supabase";
import { withPerf } from "../lib/perf";
import type { Json } from "../lib/database.types";
import {
  classifySegmentCorridor,
  segmentDirection,
} from "../lib/segment-corridor";

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

// ---------------------------------------------------------------------------
// reclassifySegmentCorridors — after a reference line changes, recompute
// corridor + direction for every stored segment (efforts are never refetched)
// ---------------------------------------------------------------------------
const RECLASSIFY_PAGE_SIZE = 500;
/** 20 pages × (1 select + 1 update) = 40 subrequests, under the 50 cap. */
const RECLASSIFY_MAX_PAGES = 20;

export interface SegmentReclassifyInput {
  /** Resume after this segment id (null/undefined = from the start). */
  cursor?: number | null;
  pageSize?: number;
  maxPages?: number;
}

export interface SegmentReclassifyResult {
  scanned: number;
  changed: number;
  /** Pass back as `cursor` to continue; null when every segment was seen. */
  nextCursor: number | null;
}

export const reclassifySegmentCorridorsImpl = withPerf(
  "reclassifySegmentCorridors",
  async (input: SegmentReclassifyInput): Promise<SegmentReclassifyResult> => {
    const pageSize = Math.min(
      RECLASSIFY_PAGE_SIZE,
      Math.max(1, Math.floor(input.pageSize ?? RECLASSIFY_PAGE_SIZE)),
    );
    const maxPages = Math.min(
      RECLASSIFY_MAX_PAGES,
      Math.max(1, Math.floor(input.maxPages ?? RECLASSIFY_MAX_PAGES)),
    );
    const supabase = createServiceClient();
    let cursor = input.cursor ?? 0;
    let scanned = 0;
    let changed = 0;

    for (let page = 0; page < maxPages; page++) {
      const { data, error } = await supabase
        .from("segments")
        .select("id, start_latlng, end_latlng, corridor, direction")
        .gt("id", cursor)
        .order("id")
        .limit(pageSize);
      if (error) throw new Error(`segments page: ${error.message}`);
      const rows = data ?? [];
      scanned += rows.length;

      const updates = rows.flatMap((s) => {
        const geom = {
          start_latlng: s.start_latlng as [number, number],
          end_latlng: s.end_latlng as [number, number],
        };
        const corridor = classifySegmentCorridor({ ...geom, average_grade: 0 });
        const direction = segmentDirection(geom, corridor);
        return corridor === s.corridor && direction === s.direction
          ? []
          : [{ id: s.id, corridor, direction }];
      });
      if (updates.length > 0) {
        const { data: n, error: upErr } = await supabase.rpc(
          "batch_update_segment_corridors",
          { p_rows: updates as unknown as Json },
        );
        if (upErr)
          throw new Error(`batch_update_segment_corridors: ${upErr.message}`);
        changed += n ?? 0;
      }

      if (rows.length < pageSize) return { scanned, changed, nextCursor: null };
      cursor = rows[rows.length - 1].id;
    }
    return { scanned, changed, nextCursor: cursor };
  },
);

export const reclassifySegmentCorridors = createServerFn({ method: "POST" })
  .inputValidator((d: SegmentReclassifyInput) => ({
    cursor: typeof d?.cursor === "number" ? d.cursor : null,
  }))
  .handler(async ({ data }) => {
    await assertAdmin();
    return reclassifySegmentCorridorsImpl(data);
  });

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
