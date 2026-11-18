/**
 * Admin tool: pick a corridor's reference ride from other riders' rides and
 * fetch its streams for the route profile (phase 09b, plan §4.5).
 *
 * 1. fetchCorridorReferenceCandidates — the newest SF→G rides of a route with
 *    their summary polylines (1 subrequest). The admin's browser scores them
 *    (app/lib/corridor-reference.ts) and shows the most typical ones.
 * 2. fetchCorridorStreams — distance/altitude/latlng streams of the chosen
 *    ride, with that rider's own token (1 Supabase + 1 Strava read, + token
 *    refresh when expired). Returned to the admin, never stored. The admin
 *    saves them and runs scripts/gen-corridor-profile.ts, which commits only
 *    the cut core of the line (never where the rider starts or ends).
 */
import { createServerFn } from "@tanstack/react-start";
import { assertAdmin } from "../lib/admin";
import { createServiceClient } from "../lib/supabase";
import { ensureValidToken } from "../lib/strava-oauth";
import {
  fetchActivityStreams,
  type StravaActivityStreams,
} from "../lib/strava";
import { withPerf } from "../lib/perf";

export const REFERENCE_CATEGORIES = ["skyline", "bayway", "hmbw"] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export interface ReferenceCandidate {
  ride_id: string;
  user_id: string;
  display_name: string;
  strava_activity_id: number;
  ride_date: string;
  distance_meters: number;
  summary_polyline: string;
}

const category = (c: unknown): ReferenceCategory =>
  REFERENCE_CATEGORIES.includes(c as ReferenceCategory)
    ? (c as ReferenceCategory)
    : "bayway";

export const fetchCorridorReferenceCandidatesImpl = withPerf(
  "fetchCorridorReferenceCandidates",
  async (input: {
    category?: string;
    limit?: number;
  }): Promise<ReferenceCandidate[]> => {
    const { data, error } = await createServiceClient().rpc(
      "corridor_reference_candidates",
      {
        p_category: category(input.category),
        p_limit: Math.min(500, Math.max(1, Math.floor(input.limit ?? 200))),
      },
    );
    if (error)
      throw new Error(`corridor_reference_candidates: ${error.message}`);
    return data as unknown as ReferenceCandidate[];
  },
);

export const fetchCorridorReferenceCandidates = createServerFn({
  method: "GET",
})
  .inputValidator((d: { category?: string; limit?: number }) => ({
    category: category(d?.category),
    limit: typeof d?.limit === "number" ? d.limit : 200,
  }))
  .handler(async ({ data }) => {
    await assertAdmin();
    return fetchCorridorReferenceCandidatesImpl(data);
  });

export const fetchCorridorStreamsImpl = withPerf(
  "fetchCorridorStreams",
  async (input: {
    rideId: string;
  }): Promise<{
    activityId: number;
    rideDate: string;
    streams: StravaActivityStreams;
  }> => {
    const { data: ride, error } = await createServiceClient()
      .from("rides")
      .select(
        "strava_activity_id, ride_date, is_private, user_id, users(strava_access_token, strava_refresh_token, strava_token_expires_at)",
      )
      .eq("id", input.rideId)
      .maybeSingle();
    if (error) throw new Error(`ride: ${error.message}`);
    if (!ride) throw new Error("No such ride");
    if (ride.is_private) throw new Error("That ride is private on Strava");
    const token = await ensureValidToken(ride.user_id, ride.users ?? undefined);
    const { streams } = await fetchActivityStreams(
      token,
      ride.strava_activity_id,
    );
    return {
      activityId: ride.strava_activity_id,
      rideDate: ride.ride_date,
      streams,
    };
  },
);

export const fetchCorridorStreams = createServerFn({ method: "POST" })
  .inputValidator((d: { rideId: string }) => ({ rideId: String(d?.rideId) }))
  .handler(async ({ data }) => {
    await assertAdmin();
    return fetchCorridorStreamsImpl(data);
  });
