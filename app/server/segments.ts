/**
 * Segment board server functions (phase 07b, matrix since 09c).
 *
 * - `fetchSegmentMatrix` — the /segments page: one get_segment_matrix call
 *   (migration 052), the only read path to segment_bests
 * - `setSegmentBoardHidden` — the logged-in rider hides or shows their times
 *
 * Strava is never called from here; segment efforts are fetched by the sync
 * queue drain (segments-ingest.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { createAnonClient, createServiceClient } from "../lib/supabase";
import type { Json } from "../lib/database.types";
import { withPerf } from "../lib/perf";
import { getSessionData } from "../lib/session";
import {
  parseCumulativeSearch,
  toMatrixParams,
  type CumulativeQuery,
} from "../lib/segment-query";
import type { SegmentMatrixResponse } from "../lib/segment-cumulative";

// ---------------------------------------------------------------------------
// fetchSegmentMatrix (phase 09c) — every rider's PR on every selectable
// segment of one route; the browser does the rest. One RPC, anon client.
// ---------------------------------------------------------------------------
export type MatrixInput = Pick<
  CumulativeQuery,
  "corridor" | "direction" | "year"
>;

export async function fetchSegmentMatrixImpl(
  input: Partial<MatrixInput>,
): Promise<SegmentMatrixResponse> {
  const q = parseCumulativeSearch(input);
  const { data, error } = await createAnonClient().rpc("get_segment_matrix", {
    q: toMatrixParams(q) as unknown as Json,
  });
  if (error) {
    console.error("[segments] get_segment_matrix failed:", error);
    throw new Error(`Failed to fetch segment matrix: ${error.message}`);
  }
  return data as unknown as SegmentMatrixResponse;
}

export const fetchSegmentMatrix = createServerFn({ method: "GET" })
  .inputValidator((input: Partial<MatrixInput>) =>
    toMatrixParams(parseCumulativeSearch(input)),
  )
  .handler(
    withPerf("fetchSegmentMatrix", ({ data }) => fetchSegmentMatrixImpl(data)),
  );

// ---------------------------------------------------------------------------
// setSegmentBoardHidden — only the session user's own row (phase 09, P1:
// everyone is on the board unless they hide)
// ---------------------------------------------------------------------------
export async function setSegmentBoardHiddenImpl(
  userId: string,
  hidden: boolean,
): Promise<{ hidden: boolean }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .update({ segment_board_hidden: hidden })
    .eq("id", userId)
    .select("segment_board_hidden")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to update segment board visibility: ${error?.message ?? "no such user"}`,
    );
  }
  return { hidden: data.segment_board_hidden };
}

export const setSegmentBoardHidden = createServerFn({ method: "POST" })
  .inputValidator((input: { hidden: boolean }) => ({
    hidden: input?.hidden === true,
  }))
  .handler(
    withPerf("setSegmentBoardHidden", async ({ data }) => {
      const session = await getSessionData();
      if (!session) throw new Error("Not authenticated");
      return setSegmentBoardHiddenImpl(session.userId, data.hidden);
    }),
  );
