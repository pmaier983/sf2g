
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "group_ride_members": {
                  Row: {
                    "avatar_url": string | null,"display_name": string | null,"group_ride_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"display_name"?: string | null,"group_ride_id": string,"user_id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"display_name"?: string | null,"group_ride_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_ride_members_group_ride_id_fkey"
      columns: ["group_ride_id"]
isOneToOne: false
      referencedRelation: "group_rides"
      referencedColumns: ["id"]
    }
                  ]
                },"group_rides": {
                  Row: {
                    "avg_heartrate": number | null,"avg_speed_mps": number | null,"avg_watts": number | null,"computed_at": string | null,"id": string,"max_speed_mps": number | null,"max_watts": number | null,"ride_date": string,"rider_count": number,"route_category": string,"total_distance_meters": number | null,"total_elevation_meters": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avg_heartrate"?: number | null,"avg_speed_mps"?: number | null,"avg_watts"?: number | null,"computed_at"?: string | null,"id": string,"max_speed_mps"?: number | null,"max_watts"?: number | null,"ride_date": string,"rider_count"?: number,"route_category": string,"total_distance_meters"?: number | null,"total_elevation_meters"?: number | null
                  }
                  Update: {
                    "avg_heartrate"?: number | null,"avg_speed_mps"?: number | null,"avg_watts"?: number | null,"computed_at"?: string | null,"id"?: string,"max_speed_mps"?: number | null,"max_watts"?: number | null,"ride_date"?: string,"rider_count"?: number,"route_category"?: string,"total_distance_meters"?: number | null,"total_elevation_meters"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"ride_override_audit_log": {
                  Row: {
                    "action": string,"created_at": string,"id": string,"is_hidden": boolean | null,"is_not_sf2g": boolean | null,"override_name": string | null,"override_route_category": string | null,"ride_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"id"?: string,"is_hidden"?: boolean | null,"is_not_sf2g"?: boolean | null,"override_name"?: string | null,"override_route_category"?: string | null,"ride_id": string,"user_id": string
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"id"?: string,"is_hidden"?: boolean | null,"is_not_sf2g"?: boolean | null,"override_name"?: string | null,"override_route_category"?: string | null,"ride_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_override_audit_log_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_override_audit_log_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride2_id"]
    },{
      foreignKeyName: "ride_override_audit_log_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ride_override_audit_log_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_override_audit_log_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride2_id"]
    },{
      foreignKeyName: "ride_override_audit_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "ride_override_audit_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "ride_override_audit_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"ride_overrides": {
                  Row: {
                    "created_at": string,"id": string,"is_hidden": boolean | null,"is_not_sf2g": boolean | null,"override_name": string | null,"override_route_category": string | null,"ride_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_hidden"?: boolean | null,"is_not_sf2g"?: boolean | null,"override_name"?: string | null,"override_route_category"?: string | null,"ride_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_hidden"?: boolean | null,"is_not_sf2g"?: boolean | null,"override_name"?: string | null,"override_route_category"?: string | null,"ride_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_overrides_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_overrides_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride2_id"]
    },{
      foreignKeyName: "ride_overrides_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ride_overrides_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_overrides_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: false
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride2_id"]
    },{
      foreignKeyName: "ride_overrides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "ride_overrides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "ride_overrides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"ride_pair_overlap": {
                  Row: {
                    "overlap": number,"ride1_id": string,"ride2_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "overlap": number,"ride1_id": string,"ride2_id": string
                  }
                  Update: {
                    "overlap"?: number,"ride1_id"?: string,"ride2_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ride_streams": {
                  Row: {
                    "fetched_at": string,"heartrate_stream": Json | null,"id": string,"latlng_stream": NonNullable<Json>,"ride_id": string,"time_stream": NonNullable<Json>,"watts_stream": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "fetched_at"?: string,"heartrate_stream"?: Json | null,"id"?: string,"latlng_stream": NonNullable<Json>,"ride_id": string,"time_stream": NonNullable<Json>,"watts_stream"?: Json | null
                  }
                  Update: {
                    "fetched_at"?: string,"heartrate_stream"?: Json | null,"id"?: string,"latlng_stream"?: NonNullable<Json>,"ride_id"?: string,"time_stream"?: NonNullable<Json>,"watts_stream"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ride_streams_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: true
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_streams_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: true
      referencedRelation: "ride_co_occurrences"
      referencedColumns: ["ride2_id"]
    },{
      foreignKeyName: "ride_streams_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: true
      referencedRelation: "rides"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ride_streams_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: true
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride1_id"]
    },{
      foreignKeyName: "ride_streams_ride_id_fkey"
      columns: ["ride_id"]
isOneToOne: true
      referencedRelation: "visible_ride_pairs"
      referencedColumns: ["ride2_id"]
    }
                  ]
                },"rides": {
                  Row: {
                    "average_heartrate": number | null,"average_speed_mps": number | null,"average_watts": number | null,"classification_confidence": number | null,"classification_method": string | null,"commute_direction": string | null,"created_at": string,"crosswind_component_ms": number | null,"destination_company": string | null,"destination_distance_meters": number | null,"destination_office": string | null,"distance_meters": number | null,"elapsed_time_seconds": number | null,"elevation_gain_meters": number | null,"end_latlng": Json | null,"has_heartrate": boolean | null,"has_power_meter": boolean | null,"id": string,"is_commute": boolean | null,"is_hidden": boolean | null,"is_ppr_dawn": boolean,"is_private": boolean | null,"kilojoules": number | null,"max_heartrate": number | null,"max_speed_mps": number | null,"max_watts": number | null,"moving_time_seconds": number | null,"name": string | null,"ride_bearing_deg": number | null,"ride_date": string,"route_category": string | null,"start_date": string,"start_latlng": Json | null,"strava_activity_id": number,"strava_raw": Json | null,"suffer_score": number | null,"summary_polyline": string | null,"tailwind_component_ms": number | null,"timezone": string | null,"user_id": string,"wind_data_source": string | null,"wind_direction_deg": number | null,"wind_gust_ms": number | null,"wind_speed_ms": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "average_heartrate"?: number | null,"average_speed_mps"?: number | null,"average_watts"?: number | null,"classification_confidence"?: number | null,"classification_method"?: string | null,"commute_direction"?: never,"created_at"?: string,"crosswind_component_ms"?: number | null,"destination_company"?: string | null,"destination_distance_meters"?: number | null,"destination_office"?: string | null,"distance_meters"?: number | null,"elapsed_time_seconds"?: number | null,"elevation_gain_meters"?: number | null,"end_latlng"?: Json | null,"has_heartrate"?: boolean | null,"has_power_meter"?: boolean | null,"id"?: string,"is_commute"?: boolean | null,"is_hidden"?: boolean | null,"is_ppr_dawn"?: boolean,"is_private"?: boolean | null,"kilojoules"?: number | null,"max_heartrate"?: number | null,"max_speed_mps"?: number | null,"max_watts"?: number | null,"moving_time_seconds"?: number | null,"name"?: string | null,"ride_bearing_deg"?: number | null,"ride_date": string,"route_category"?: string | null,"start_date": string,"start_latlng"?: Json | null,"strava_activity_id": number,"strava_raw"?: Json | null,"suffer_score"?: number | null,"summary_polyline"?: string | null,"tailwind_component_ms"?: number | null,"timezone"?: string | null,"user_id": string,"wind_data_source"?: string | null,"wind_direction_deg"?: number | null,"wind_gust_ms"?: number | null,"wind_speed_ms"?: number | null
                  }
                  Update: {
                    "average_heartrate"?: number | null,"average_speed_mps"?: number | null,"average_watts"?: number | null,"classification_confidence"?: number | null,"classification_method"?: string | null,"commute_direction"?: never,"created_at"?: string,"crosswind_component_ms"?: number | null,"destination_company"?: string | null,"destination_distance_meters"?: number | null,"destination_office"?: string | null,"distance_meters"?: number | null,"elapsed_time_seconds"?: number | null,"elevation_gain_meters"?: number | null,"end_latlng"?: Json | null,"has_heartrate"?: boolean | null,"has_power_meter"?: boolean | null,"id"?: string,"is_commute"?: boolean | null,"is_hidden"?: boolean | null,"is_ppr_dawn"?: boolean,"is_private"?: boolean | null,"kilojoules"?: number | null,"max_heartrate"?: number | null,"max_speed_mps"?: number | null,"max_watts"?: number | null,"moving_time_seconds"?: number | null,"name"?: string | null,"ride_bearing_deg"?: number | null,"ride_date"?: string,"route_category"?: string | null,"start_date"?: string,"start_latlng"?: Json | null,"strava_activity_id"?: number,"strava_raw"?: Json | null,"suffer_score"?: number | null,"summary_polyline"?: string | null,"tailwind_component_ms"?: number | null,"timezone"?: string | null,"user_id"?: string,"wind_data_source"?: string | null,"wind_direction_deg"?: number | null,"wind_gust_ms"?: number | null,"wind_speed_ms"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"cursor": NonNullable<Json>,"finished_at": string | null,"id": number,"kind": string,"last_error": string | null,"locked_at": string | null,"payload": NonNullable<Json>,"run_after": string,"status": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"cursor"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: number,"kind": string,"last_error"?: string | null,"locked_at"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"cursor"?: NonNullable<Json>,"finished_at"?: string | null,"id"?: number,"kind"?: string,"last_error"?: string | null,"locked_at"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_jobs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "sync_jobs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "sync_jobs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"users": {
                  Row: {
                    "avatar_url": string | null,"consecutive_sync_failures": number,"created_at": string,"deauthorized_at": string | null,"display_name": string | null,"first_name": string | null,"id": string,"last_activity_at": string | null,"last_name": string | null,"last_sync_at": string | null,"last_sync_error": string | null,"last_sync_success_at": string | null,"needs_reauth": boolean,"strava_access_token": string,"strava_id": number,"strava_refresh_token": string,"strava_scopes": string | null,"strava_token_expires_at": string,"updated_at": string,"username": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"consecutive_sync_failures"?: number,"created_at"?: string,"deauthorized_at"?: string | null,"display_name"?: never,"first_name"?: string | null,"id"?: string,"last_activity_at"?: string | null,"last_name"?: string | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_success_at"?: string | null,"needs_reauth"?: boolean,"strava_access_token": string,"strava_id": number,"strava_refresh_token": string,"strava_scopes"?: string | null,"strava_token_expires_at": string,"updated_at"?: string,"username"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"consecutive_sync_failures"?: number,"created_at"?: string,"deauthorized_at"?: string | null,"display_name"?: never,"first_name"?: string | null,"id"?: string,"last_activity_at"?: string | null,"last_name"?: string | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_success_at"?: string | null,"needs_reauth"?: boolean,"strava_access_token"?: string,"strava_id"?: number,"strava_refresh_token"?: string,"strava_scopes"?: string | null,"strava_token_expires_at"?: string,"updated_at"?: string,"username"?: string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "monthly_ride_stats": {
                  Row: {
                    "avg_speed": number | null,"month": string | null,"ride_count": number | null,"route_category": string | null,"total_distance": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"ride_co_occurrences": {
                  Row: {
                    "polyline1": string | null,"polyline2": string | null,"ride_date": string | null,"ride1_id": string | null,"ride2_id": string | null,"rider1_id": string | null,"rider2_id": string | null,"route_category": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_health": {
                  Row: {
                    "consecutive_sync_failures": number | null,"deauthorized_at": string | null,"display_name": string | null,"failed_jobs": number | null,"last_activity_at": string | null,"last_sync_at": string | null,"last_sync_error": string | null,"last_sync_success_at": string | null,"needs_reauth": boolean | null,"open_jobs": number | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "consecutive_sync_failures"?: number | null,"deauthorized_at"?: string | null,"display_name"?: string | null,"failed_jobs"?: never,"last_activity_at"?: string | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_success_at"?: string | null,"needs_reauth"?: boolean | null,"open_jobs"?: never,"user_id"?: string | null
                         }
                        Update: {
                           "consecutive_sync_failures"?: number | null,"deauthorized_at"?: string | null,"display_name"?: string | null,"failed_jobs"?: never,"last_activity_at"?: string | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_success_at"?: string | null,"needs_reauth"?: boolean | null,"open_jobs"?: never,"user_id"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"visible_ride_pairs": {
                  Row: {
                    "overlap": number | null,"ride_date": string | null,"ride1_id": string | null,"ride2_id": string | null,"rider1_id": string | null,"rider2_id": string | null,"route_category": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "monthly_ride_stats"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "sync_health"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider1_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rides_user_id_fkey"
      columns: ["rider2_id"]
isOneToOne: false
      referencedRelation: "users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "batch_update_ride_classifications":
{ Args: { "updates": Json }; Returns: number
                           },
"claim_sync_jobs":
{ Args: { "n": number }; Returns: {
              "attempts": number,
"created_at": string,
"cursor": NonNullable<Json>,
"finished_at": string | null,
"id": number,
"kind": string,
"last_error": string | null,
"locked_at": string | null,
"payload": NonNullable<Json>,
"run_after": string,
"status": string,
"updated_at": string,
"user_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "sync_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"enqueue_due_syncs":
{ Args: { "p_limit"?: number,"p_older_than"?: string }; Returns: number
                           },
"enqueue_sync_job":
{ Args: { "p_cursor"?: Json,"p_kind": string,"p_payload"?: Json,"p_run_after"?: string,"p_user_id"?: string }; Returns: boolean
                           },
"enqueue_webhook_event":
{ Args: { "p_aspect_type": string,"p_object_id": number,"p_object_type": string,"p_owner_id": number,"p_updates"?: Json }; Returns: string
                           },
"extract_iana_timezone":
{ Args: { "tz": string }; Returns: string
                           },
"get_alltime_leaderboard":
{ Args: { "q"?: Json }; Returns: Json
                           },
"get_community_breakdown":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_community_start_hours":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_community_streaks":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_leaderboard":
{ Args: { "q"?: Json }; Returns: {
              "active_years": number,"avatar_url": string,"avg_heartrate": number,"avg_kilojoules": number,"avg_speed_mps": number,"avg_tailwind_ms": number,"avg_watts": number,"bayway_count": number,"display_name": string,"febw_count": number,"first_ride_date": string,"fleaway_count": number,"hmbw_count": number,"last_ride_date": string,"mebw_count": number,"median_speed_mps": number,"median_watts": number,"other_count": number,"royale_count": number,"sf2g_distance_meters": number,"sf2g_elevation_meters": number,"sf2g_total": number,"skyline_count": number,"total_count": number,"total_distance_meters": number,"total_elevation_meters": number,"total_rides": number,"user_id": string,"username": string
            }[]
                           },
"get_leaderboard_by_date_range":
{ Args: { "p_date_from"?: string,"p_date_to"?: string,"p_exclude_weekends"?: boolean }; Returns: {
              "active_years": number,"avatar_url": string,"avg_heartrate": number,"avg_kilojoules": number,"avg_speed_mps": number,"avg_tailwind_ms": number,"avg_watts": number,"bayway_count": number,"display_name": string,"febw_count": number,"first_ride_date": string,"fleaway_count": number,"hmbw_count": number,"last_ride_date": string,"mebw_count": number,"median_speed_mps": number,"median_watts": number,"other_count": number,"royale_count": number,"sf2g_distance_meters": number,"sf2g_elevation_meters": number,"sf2g_total": number,"skyline_count": number,"total_distance_meters": number,"total_elevation_meters": number,"total_rides": number,"user_id": string,"username": string
            }[]
                           },
"get_profile_rides":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"get_rider_growth":
{ Args: { "granularity": string,"q": Json,"rider_ids": (string)[] }; Returns: Json
                           },
"get_rider_network":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_rides":
{ Args: { "q"?: Json }; Returns: {
              "avatar_url": string,"average_heartrate": number,"average_speed_mps": number,"average_watts": number,"destination_company": string,"display_name": string,"distance_meters": number,"elevation_gain_meters": number,"end_latlng": Json,"id": string,"kilojoules": number,"max_heartrate": number,"max_watts": number,"moving_time_seconds": number,"name": string,"ride_date": string,"route_category": string,"start_latlng": Json,"strava_activity_id": number,"total_count": number,"user_id": string,"username": string
            }[]
                           },
"get_user_ride_totals":
{ Args: { "p_date_from"?: string,"p_date_to"?: string }; Returns: {
              "total_distance": number,"total_elevation": number,"user_id": string
            }[]
                           },
"reapply_ride_overrides":
{ Args: { "p_user_id": string }; Returns: number
                           },
"recompute_group_rides":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"refresh_ride_co_occurrences":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"sf2g_commute_direction":
{ Args: { "end_latlng": Json,"start_latlng": Json }; Returns: string
                           },
"sf2g_counts_other":
{ Args: { "q": Json }; Returns: boolean
                           },
"sf2g_decode_polyline":
{ Args: { "encoded": string }; Returns: {
              "idx": number,"lat": number,"lng": number
            }[]
                           },
"sf2g_filtered_rides":
{ Args: { "q": Json }; Returns: {
              "average_heartrate": number | null,
"average_speed_mps": number | null,
"average_watts": number | null,
"classification_confidence": number | null,
"classification_method": string | null,
"commute_direction": string | null,
"created_at": string,
"crosswind_component_ms": number | null,
"destination_company": string | null,
"destination_distance_meters": number | null,
"destination_office": string | null,
"distance_meters": number | null,
"elapsed_time_seconds": number | null,
"elevation_gain_meters": number | null,
"end_latlng": Json | null,
"has_heartrate": boolean | null,
"has_power_meter": boolean | null,
"id": string,
"is_commute": boolean | null,
"is_hidden": boolean | null,
"is_ppr_dawn": boolean,
"is_private": boolean | null,
"kilojoules": number | null,
"max_heartrate": number | null,
"max_speed_mps": number | null,
"max_watts": number | null,
"moving_time_seconds": number | null,
"name": string | null,
"ride_bearing_deg": number | null,
"ride_date": string,
"route_category": string | null,
"start_date": string,
"start_latlng": Json | null,
"strava_activity_id": number,
"strava_raw": Json | null,
"suffer_score": number | null,
"summary_polyline": string | null,
"tailwind_component_ms": number | null,
"timezone": string | null,
"user_id": string,
"wind_data_source": string | null,
"wind_direction_deg": number | null,
"wind_gust_ms": number | null,
"wind_speed_ms": number | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "rides"
        isOneToOne: false
        isSetofReturn: true
      } },
"sf2g_is_ppr_dawn":
{ Args: { "moving_time_seconds": number,"polyline": string,"start_date": string,"tz": string }; Returns: boolean
                           },
"sf2g_point_in_corridor":
{ Args: { "lat": number,"lng": number }; Returns: boolean
                           },
"sf2g_point_in_sf":
{ Args: { "lat": number,"lng": number }; Returns: boolean
                           },
"sf2g_polyline_overlap":
{ Args: { "p1": string,"p2": string }; Returns: number
                           },
"sf2g_week_key":
{ Args: { "d": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
