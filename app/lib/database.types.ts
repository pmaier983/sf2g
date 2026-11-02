// ---------------------------------------------------------------------------
// Domain types (manually maintained — do NOT remove on db:types regeneration)
// ---------------------------------------------------------------------------
export type RouteCategory =
  | "bayway"
  | "skyline"
  | "hmbw"
  | "royale"
  | "fleaway"
  | "mebw"
  | "febw"
  | "other";
export type ClassificationMethod = "gateway" | "elevation" | "manual";
export type DestinationCompany =
  | "netflix"
  | "google"
  | "apple"
  | "meta"
  | "nvidia"
  | "stanford"
  | "tesla";

// ---------------------------------------------------------------------------
// Generated database types — regenerate with `pnpm db:types` (writes
// database.generated.ts); everything below is maintained by hand.
// ---------------------------------------------------------------------------
import type { Database } from "./database.generated";
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./database.generated";
export { Constants } from "./database.generated";

// ---------------------------------------------------------------------------
// Convenience type aliases (manually maintained — do NOT remove on db:types regeneration)
// ---------------------------------------------------------------------------
type _Tables = Database["public"]["Tables"];
type _Views = Database["public"]["Views"];

export type User = _Tables["users"]["Row"];
export type UserInsert = _Tables["users"]["Insert"];
export type UserUpdate = _Tables["users"]["Update"];

export type Ride = _Tables["rides"]["Row"];
export type RideInsert = _Tables["rides"]["Insert"];
export type RideUpdate = _Tables["rides"]["Update"];

/** The fields the profile statistics use (get_profile_rides, migration 039). */
export type ProfileRide = Pick<
  Ride,
  | "id"
  | "strava_activity_id"
  | "name"
  | "ride_date"
  | "start_date"
  | "route_category"
  | "distance_meters"
  | "elevation_gain_meters"
  | "moving_time_seconds"
  | "average_speed_mps"
>;

export type Segment = _Tables["segments"]["Row"];
export type SegmentInsert = _Tables["segments"]["Insert"];
export type SegmentEffort = _Tables["segment_efforts"]["Row"];
export type SegmentEffortInsert = _Tables["segment_efforts"]["Insert"];

export type RideStream = _Tables["ride_streams"]["Row"];
export type RideStreamInsert = _Tables["ride_streams"]["Insert"];

/** One row of the Riders leaderboard (get_leaderboard, migration 037). */
export type LeaderboardEntry = Omit<
  Database["public"]["Functions"]["get_leaderboard"]["Returns"][number],
  "total_count"
>;
export type MonthlyRideStat = _Views["monthly_ride_stats"]["Row"];

// ---------------------------------------------------------------------------
// Rides leaderboard types
// ---------------------------------------------------------------------------
export interface RideLeaderboardEntry {
  id: string;
  user_id: string;
  strava_activity_id: number;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  name: string | null; // ride name from Strava
  ride_date: string;
  route_category: RouteCategory | null;
  average_speed_mps: number | null;
  distance_meters: number;
  elevation_gain_meters: number;
  moving_time_seconds: number;
  destination_company: DestinationCompany | null;
  tailwind_component_ms: number | null;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  average_watts: number | null;
  max_watts: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  kilojoules: number | null;
}

export interface RidesLeaderboardResponse {
  rides: RideLeaderboardEntry[];
  totalCount: number;
  page: number;
  pageSize: number;
}
