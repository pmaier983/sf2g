/**
 * Segment board server functions (phase 07b).
 *
 * - `fetchSegmentLeaderboard` — the /segments page: one get_segment_leaderboard
 *   call (migrations 045/046), the only read path to segment_efforts
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
  parseSegmentSearch,
  toMatrixParams,
  toSegmentSqlParams,
  type CumulativeQuery,
  type SegmentQuery,
} from "../lib/segment-query";
import type { SegmentMatrixResponse } from "../lib/segment-cumulative";

// ---------------------------------------------------------------------------
// Response shape of get_segment_leaderboard
// ---------------------------------------------------------------------------
export interface SegmentRider {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  best_seconds: number;
  /** Ride date (YYYY-MM-DD) of the best effort. */
  best_date: string;
  strava_activity_id: number;
  /** Dense rank among opted-in riders on this segment. */
  rank: number;
  /** KOM (overall) time / best time; null when the KOM is unknown. */
  pct_of_kom: number | null;
  /** Best Strava leaderboard rank (top 10) of any effort, when Strava gave one. */
  kom_rank: number | null;
  effort_count: number;
}

export interface SegmentBoardRow {
  id: number;
  name: string;
  distance_meters: number;
  average_grade: number;
  terrain: "climb" | "flat";
  direction: "south" | "north";
  /** [lat, lng] — places the segment on the route view (phase 07c). */
  start_latlng: [number, number];
  end_latlng: [number, number];
  kom_seconds: number | null;
  qom_seconds: number | null;
  curated_rank: number | null;
  rider_count: number;
  riders: SegmentRider[];
}

export interface SegmentCrownEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  rank: number;
  sf2g_koms: number;
  podiums: number;
  strava_top10s: number;
  segments_ridden: number;
  segments_total: number;
  points: number;
  mean_pct_of_kom: number | null;
}

export interface SegmentLeaderboard {
  corridor: string;
  segments_total: number;
  segments: SegmentBoardRow[];
  crown: SegmentCrownEntry[];
}

// ---------------------------------------------------------------------------
// fetchSegmentLeaderboard — one RPC on the anon client
// ---------------------------------------------------------------------------
export async function fetchSegmentLeaderboardImpl(
  input: Partial<SegmentQuery>,
): Promise<SegmentLeaderboard> {
  const q = parseSegmentSearch(input);
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("get_segment_leaderboard", {
    q: toSegmentSqlParams(q) as unknown as Json,
  });
  if (error) {
    console.error("[segments] get_segment_leaderboard failed:", error);
    throw new Error(`Failed to fetch segment leaderboard: ${error.message}`);
  }
  return data as unknown as SegmentLeaderboard;
}

export const fetchSegmentLeaderboard = createServerFn({ method: "GET" })
  .inputValidator((input: Partial<SegmentQuery>) => parseSegmentSearch(input))
  .handler(
    withPerf("fetchSegmentLeaderboard", ({ data }) =>
      fetchSegmentLeaderboardImpl(data),
    ),
  );

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
