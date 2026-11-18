/**
 * Segment ingest job steps (rework phase 07a), run only by the sync drain.
 *
 * Strava has no segment leaderboard endpoint, so the board is built from
 * each connected rider's own efforts:
 * - segment_efforts: one GET /activities/{id}?include_all_efforts=true per
 *   ride → `segments` rows and the rider's yearly bests (`segment_bests`,
 *   phase 09: PRs only, not every effort), in one ingest RPC.
 * - segment_xoms: one GET /segments/{id} per corridor segment → KOM/QOM.
 *
 * Raw Strava responses are never stored (API terms); only mapped columns.
 */
import { createServiceClient } from "../lib/supabase";
import { ensureValidToken } from "../lib/strava-oauth";
import {
  fetchActivityDetail,
  fetchSegment,
  type StravaSegmentEffort,
  type StravaSegmentSummary,
} from "../lib/strava";
import {
  classifySegmentCorridor,
  parseXomTime,
  segmentDirection,
  segmentPlacement,
} from "../lib/segment-corridor";
import { logPerf, trackSubrequests } from "../lib/perf";
import type { Json, SegmentInsert } from "../lib/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type SegmentEffortsOutcome =
  | "efforts_stored"
  | "ride_not_found"
  | "ride_missing";

export interface SegmentEffortsResult {
  outcome: SegmentEffortsOutcome;
  efforts: number;
  segments: number;
  /** Strava usage is near its limit: the drain should stop for this tick. */
  rateLimited: boolean;
}

const isLatLng = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number");

/** Summary columns only — never curated_rank, hidden or the xoms columns. */
export function segmentToUpsert(s: StravaSegmentSummary): SegmentInsert {
  const corridor = classifySegmentCorridor(s);
  return {
    id: s.id,
    name: s.name,
    distance_meters: s.distance,
    average_grade: s.average_grade,
    maximum_grade: s.maximum_grade ?? null,
    elevation_high: s.elevation_high ?? null,
    elevation_low: s.elevation_low ?? null,
    climb_category: s.climb_category ?? null,
    start_latlng: s.start_latlng,
    end_latlng: s.end_latlng,
    hazardous: s.hazardous ?? false,
    corridor,
    direction: segmentDirection(s, corridor),
    ...segmentPlacement(s, corridor),
    updated_at: new Date().toISOString(),
  };
}

/** What ingest_ride_segment_efforts needs of one effort (the best per segment is picked in SQL). */
export interface EffortForIngest {
  id: number;
  segment_id: number;
  elapsed_time_seconds: number;
  average_watts: number | null;
  kom_rank: number | null;
}

export function effortForIngest(e: StravaSegmentEffort): EffortForIngest {
  return {
    id: e.id,
    segment_id: e.segment.id,
    elapsed_time_seconds: e.elapsed_time,
    average_watts: e.average_watts ?? null,
    kom_rank: e.kom_rank ?? null,
  };
}

/**
 * One segment_efforts job step: 1 Strava read + 2 Supabase calls (ride and
 * token read; ingest_ride_segment_efforts, which also queues KOM refreshes
 * for up to 3 new corridor segments), plus the token refresh when it expired.
 */
export async function segmentEffortsStep(
  rideId: string,
  supabase: ServiceClient,
): Promise<SegmentEffortsResult> {
  const startedAt = Date.now();
  const { result, subrequests } = await trackSubrequests(() =>
    ingestRide(rideId, supabase),
  );
  logPerf("segment_efforts", subrequests, startedAt);
  return result;
}

async function ingestRide(
  rideId: string,
  supabase: ServiceClient,
): Promise<SegmentEffortsResult> {
  const { data: ride, error } = await supabase
    .from("rides")
    .select(
      "id, user_id, strava_activity_id, users(strava_access_token, strava_refresh_token, strava_token_expires_at)",
    )
    .eq("id", rideId)
    .maybeSingle();
  if (error) throw new Error(`segment_efforts ride: ${error.message}`);
  if (!ride) {
    return {
      outcome: "ride_missing",
      efforts: 0,
      segments: 0,
      rateLimited: false,
    };
  }

  const accessToken = await ensureValidToken(
    ride.user_id,
    ride.users ?? undefined,
  );
  const markFetched = async () => {
    const { error: e } = await supabase
      .from("rides")
      .update({ segment_efforts_fetched_at: new Date().toISOString() })
      .eq("id", rideId);
    if (e) throw new Error(`segment_efforts mark ride: ${e.message}`);
  };

  let detail: Awaited<ReturnType<typeof fetchActivityDetail>>;
  try {
    detail = await fetchActivityDetail(accessToken, ride.strava_activity_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Deleted or made private on Strava: never ask again.
    if (msg.includes("(404)")) {
      await markFetched();
      return {
        outcome: "ride_not_found",
        efforts: 0,
        segments: 0,
        rateLimited: false,
      };
    }
    throw err;
  }
  const rateLimited = !!detail.response.__approachingRateLimit;

  const efforts = (detail.activity.segment_efforts ?? []).filter(
    (e) =>
      e.segment?.activity_type === "Ride" &&
      isLatLng(e.segment.start_latlng) &&
      isLatLng(e.segment.end_latlng),
  );
  // A ride can cross the same segment twice (laps); upsert each segment once.
  const segments = [
    ...new Map(efforts.map((e) => [e.segment.id, e.segment])).values(),
  ].map(segmentToUpsert);

  const { data, error: ingestErr } = await supabase.rpc(
    "ingest_ride_segment_efforts",
    {
      p_ride_id: rideId,
      p_segments: segments as unknown as Json,
      p_efforts: efforts.map(effortForIngest) as unknown as Json,
    },
  );
  if (ingestErr)
    throw new Error(`ingest_ride_segment_efforts: ${ingestErr.message}`);
  const status = (data as { status?: string } | null)?.status;
  if (status === "ride_missing") {
    return { outcome: "ride_missing", efforts: 0, segments: 0, rateLimited };
  }
  return {
    outcome: "efforts_stored",
    efforts: efforts.length,
    segments: segments.length,
    rateLimited,
  };
}

/** One segment_xoms job step: 1 Strava read + 1 Supabase update (+ token read/refresh). */
export async function segmentXomsStep(
  segmentId: number,
  userId: string,
  supabase: ServiceClient,
): Promise<{ updated: boolean; rateLimited: boolean }> {
  const accessToken = await ensureValidToken(userId);
  const fetchedAt = new Date().toISOString();

  let fetched: Awaited<ReturnType<typeof fetchSegment>>;
  try {
    fetched = await fetchSegment(accessToken, segmentId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("(404)")) throw err;
    // Gone or private on Strava: don't retry it every tick.
    await supabase
      .from("segments")
      .update({ xoms_fetched_at: fetchedAt })
      .eq("id", segmentId);
    return { updated: false, rateLimited: false };
  }

  const { segment, response } = fetched;
  const kom = parseXomTime(segment.xoms?.kom);
  const qom = parseXomTime(segment.xoms?.qom);
  const overall = parseXomTime(segment.xoms?.overall);
  const updated = kom !== null || qom !== null || overall !== null;

  const { error } = await supabase
    .from("segments")
    .update({
      ...(updated
        ? { kom_seconds: kom, qom_seconds: qom, overall_seconds: overall }
        : {}),
      ...(segment.effort_count !== undefined
        ? { effort_count: segment.effort_count }
        : {}),
      ...(segment.athlete_count !== undefined
        ? { athlete_count: segment.athlete_count }
        : {}),
      xoms_fetched_at: fetchedAt,
      updated_at: fetchedAt,
    })
    .eq("id", segmentId);
  if (error) throw new Error(`segment_xoms update: ${error.message}`);
  return { updated, rateLimited: !!response.__approachingRateLimit };
}
