/**
 * Hand-written TypeScript types matching the SQL schema in
 * supabase/migrations/001_initial_schema.sql
 *
 * These types mirror what `supabase gen types` would produce.
 * Run `pnpm db:types` to regenerate from a linked Supabase project.
 */

// ---------------------------------------------------------------------------
// Route category literal union
// ---------------------------------------------------------------------------
export type RouteCategory = 'bayway' | 'skyline' | 'hmbw' | 'royale' | 'fleaway' | 'mebw' | 'febw' | 'other'
export type ClassificationMethod = 'gateway' | 'elevation' | 'manual'
export type DestinationCompany = 'netflix' | 'google' | 'apple' | 'meta' | 'nvidia' | 'stanford' | 'tesla'

// JSON-serializable value type (compatible with TanStack Start serialization)
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// Database schema type (Supabase-style)
// ---------------------------------------------------------------------------
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          strava_id: number
          username: string | null
          first_name: string | null
          last_name: string | null
          display_name: string | null // GENERATED column
          avatar_url: string | null
          strava_access_token: string
          strava_refresh_token: string
          strava_token_expires_at: string
          strava_scopes: string | null
          last_sync_at: string | null
          last_activity_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          strava_id: number
          username?: string | null
          first_name?: string | null
          last_name?: string | null
          // display_name is GENERATED — never include in INSERT
          avatar_url?: string | null
          strava_access_token: string
          strava_refresh_token: string
          strava_token_expires_at: string
          strava_scopes?: string | null
          last_sync_at?: string | null
          last_activity_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          strava_id?: number
          username?: string | null
          first_name?: string | null
          last_name?: string | null
          // display_name is GENERATED — never include in UPDATE
          avatar_url?: string | null
          strava_access_token?: string
          strava_refresh_token?: string
          strava_token_expires_at?: string
          strava_scopes?: string | null
          last_sync_at?: string | null
          last_activity_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      rides: {
        Row: {
          id: string
          user_id: string
          strava_activity_id: number
          name: string | null
          ride_date: string
          start_date: string
          timezone: string | null
          route_category: RouteCategory | null
          classification_confidence: number | null
          classification_method: ClassificationMethod | null
          distance_meters: number | null
          moving_time_seconds: number | null
          elapsed_time_seconds: number | null
          elevation_gain_meters: number | null
          average_speed_mps: number | null
          max_speed_mps: number | null
          start_latlng: [number, number] | null
          end_latlng: [number, number] | null
          summary_polyline: string | null
          is_commute: boolean
          is_private: boolean
          destination_company: DestinationCompany | null
          destination_office: string | null
          destination_distance_meters: number | null
          strava_raw: JsonValue | null
          wind_speed_ms: number | null
          wind_direction_deg: number | null
          wind_gust_ms: number | null
          ride_bearing_deg: number | null
          tailwind_component_ms: number | null
          crosswind_component_ms: number | null
          wind_data_source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          strava_activity_id: number
          name?: string | null
          ride_date: string
          start_date: string
          timezone?: string | null
          route_category?: RouteCategory | null
          classification_confidence?: number | null
          classification_method?: ClassificationMethod | null
          distance_meters?: number | null
          moving_time_seconds?: number | null
          elapsed_time_seconds?: number | null
          elevation_gain_meters?: number | null
          average_speed_mps?: number | null
          max_speed_mps?: number | null
          start_latlng?: [number, number] | null
          end_latlng?: [number, number] | null
          summary_polyline?: string | null
          is_commute?: boolean
          is_private?: boolean
          destination_company?: DestinationCompany | null
          destination_office?: string | null
          destination_distance_meters?: number | null
          strava_raw?: JsonValue | null
          wind_speed_ms?: number | null
          wind_direction_deg?: number | null
          wind_gust_ms?: number | null
          ride_bearing_deg?: number | null
          tailwind_component_ms?: number | null
          crosswind_component_ms?: number | null
          wind_data_source?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          strava_activity_id?: number
          name?: string | null
          ride_date?: string
          start_date?: string
          timezone?: string | null
          route_category?: RouteCategory | null
          classification_confidence?: number | null
          classification_method?: ClassificationMethod | null
          distance_meters?: number | null
          moving_time_seconds?: number | null
          elapsed_time_seconds?: number | null
          elevation_gain_meters?: number | null
          average_speed_mps?: number | null
          max_speed_mps?: number | null
          start_latlng?: [number, number] | null
          end_latlng?: [number, number] | null
          summary_polyline?: string | null
          is_commute?: boolean
          is_private?: boolean
          destination_company?: DestinationCompany | null
          destination_office?: string | null
          destination_distance_meters?: number | null
          strava_raw?: JsonValue | null
          wind_speed_ms?: number | null
          wind_direction_deg?: number | null
          wind_gust_ms?: number | null
          ride_bearing_deg?: number | null
          tailwind_component_ms?: number | null
          crosswind_component_ms?: number | null
          wind_data_source?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leaderboard_view: {
        Row: {
          user_id: string
          display_name: string | null
          avatar_url: string | null
          username: string | null
          sf2g_total: number
          total_rides: number
          bayway_count: number
          skyline_count: number
          hmbw_count: number
          royale_count: number
          fleaway_count: number
          mebw_count: number
          febw_count: number
          other_count: number
          total_distance_meters: number
          total_elevation_meters: number
          sf2g_distance_meters: number
          sf2g_elevation_meters: number
          avg_speed_mps: number
          active_years: number
          last_ride_date: string | null
          first_ride_date: string | null
          avg_tailwind_ms: number
        }
        Relationships: []
      }
      monthly_ride_stats: {
        Row: {
          user_id: string
          month: string
          route_category: RouteCategory | null
          ride_count: number
          total_distance: number | null
          avg_speed: number | null
        }
        Relationships: []
      }
      company_leaderboard_view: {
        Row: {
          user_id: string
          display_name: string | null
          avatar_url: string | null
          username: string | null
          total_company_rides: number
          netflix_count: number
          google_count: number
          apple_count: number
          meta_count: number
          nvidia_count: number
          tesla_count: number
          total_distance_meters: number
          total_elevation_meters: number
          avg_speed_mps: number
          last_ride_date: string | null
          first_ride_date: string | null
        }
        Relationships: []
      }
      route_speed_leaderboard: {
        Row: {
          user_id: string
          display_name: string | null
          avatar_url: string | null
          username: string | null
          route_category: RouteCategory
          route_ride_count: number
          avg_speed_mps: number
          max_speed_mps: number
          avg_distance_meters: number
          avg_elevation_meters: number
          last_ride_date: string | null
        }
        Relationships: []
      }
      ppr_dawn_rides: {
        Row: {
          ride_id: string
          user_id: string
          start_date: string
          start_latlng: [number, number] | null
          summary_polyline: string | null
          moving_time_seconds: number | null
          timezone: string | null
        }
        Relationships: []
      }
      ride_co_occurrences: {
        Row: {
          ride1_id: string
          rider1_id: string
          ride2_id: string
          rider2_id: string
          route_category: RouteCategory
          ride_date: string
          polyline1: string | null
          polyline2: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      refresh_leaderboard: {
        Args: Record<string, never>
        Returns: void
      }
      refresh_company_leaderboard: {
        Args: Record<string, never>
        Returns: void
      }
      batch_update_ride_classifications: {
        Args: { updates: unknown[] }
        Returns: number
      }
      refresh_ppr_dawn_rides: {
        Args: Record<string, never>
        Returns: void
      }
      refresh_route_speed_leaderboard: {
        Args: Record<string, never>
        Returns: void
      }
      refresh_ride_co_occurrences: {
        Args: Record<string, never>
        Returns: void
      }
      get_leaderboard_by_date_range: {
        Args: {
          p_date_from?: string | null
          p_date_to?: string | null
        }
        Returns: Array<{
          user_id: string
          display_name: string | null
          avatar_url: string | null
          username: string | null
          sf2g_total: number
          total_rides: number
          bayway_count: number
          skyline_count: number
          hmbw_count: number
          royale_count: number
          fleaway_count: number
          mebw_count: number
          febw_count: number
          other_count: number
          avg_speed_mps: number
          sf2g_distance_meters: number
          sf2g_elevation_meters: number
          total_distance_meters: number
          total_elevation_meters: number
          active_years: number
          last_ride_date: string | null
          first_ride_date: string | null
          avg_tailwind_ms: number
        }>
      }
      get_user_ride_totals: {
        Args: {
          p_date_from?: string | null
          p_date_to?: string | null
        }
        Returns: Array<{
          user_id: string
          total_distance: number
          total_elevation: number
        }>
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience type aliases
// ---------------------------------------------------------------------------
type Tables = Database['public']['Tables']
type Views = Database['public']['Views']

export type User = Tables['users']['Row']
export type UserInsert = Tables['users']['Insert']
export type UserUpdate = Tables['users']['Update']

export type Ride = Tables['rides']['Row']
export type RideInsert = Tables['rides']['Insert']
export type RideUpdate = Tables['rides']['Update']

export type LeaderboardEntry = Views['leaderboard_view']['Row']
export type CompanyLeaderboardEntry = Views['company_leaderboard_view']['Row']
export type MonthlyRideStat = Views['monthly_ride_stats']['Row']
export type RouteSpeedEntry = Views['route_speed_leaderboard']['Row']
export type PprDawnRide = Views['ppr_dawn_rides']['Row']

// ---------------------------------------------------------------------------
// Rides leaderboard types
// ---------------------------------------------------------------------------
export interface RideLeaderboardEntry {
  id: string
  user_id: string
  strava_activity_id: number
  display_name: string | null
  avatar_url: string | null
  username: string | null
  name: string | null // ride name from Strava
  ride_date: string
  route_category: RouteCategory | null
  average_speed_mps: number | null
  distance_meters: number
  elevation_gain_meters: number
  moving_time_seconds: number
  destination_company: DestinationCompany | null
  tailwind_component_ms: number | null
  start_latlng: [number, number] | null
  end_latlng: [number, number] | null
}

export interface RidesLeaderboardResponse {
  rides: RideLeaderboardEntry[]
  totalCount: number
  page: number
  pageSize: number
}
