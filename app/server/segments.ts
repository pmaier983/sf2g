/**
 * Segment board server functions (phase 07b).
 *
 * - `fetchSegmentLeaderboard` — the /segments page: one get_segment_leaderboard
 *   call (migration 045), the only read path to segment_efforts
 * - `setSegmentBoardOptIn` — the logged-in rider opts in or out of the board
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
  parseSegmentSearch,
  toSegmentSqlParams,
  type SegmentQuery,
} from "../lib/segment-query";

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
// setSegmentBoardOptIn — only the session user's own row
// ---------------------------------------------------------------------------
export async function setSegmentBoardOptInImpl(
  userId: string,
  optIn: boolean,
): Promise<{ optIn: boolean }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .update({ segment_board_opt_in: optIn })
    .eq("id", userId)
    .select("segment_board_opt_in")
    .single();
  if (error || !data) {
    throw new Error(
      `Failed to update segment board opt-in: ${error?.message ?? "no such user"}`,
    );
  }
  return { optIn: data.segment_board_opt_in };
}

export const setSegmentBoardOptIn = createServerFn({ method: "POST" })
  .inputValidator((input: { optIn: boolean }) => ({
    optIn: input?.optIn === true,
  }))
  .handler(
    withPerf("setSegmentBoardOptIn", async ({ data }) => {
      const session = await getSessionData();
      if (!session) throw new Error("Not authenticated");
      return setSegmentBoardOptInImpl(session.userId, data.optIn);
    }),
  );
