-- One-time backfills below can exceed the API roles' 8 s statement timeout.
SET statement_timeout = 0;

-- ============================================================
-- Migration 039: lean profile ride list (rework phase 03c)
-- ============================================================
-- The profile page used to request every ride with select('*') and
-- limit 10000. PostgREST's max_rows (1000) silently truncated heavy riders,
-- and every row carried its polyline and raw Strava payload through the
-- Worker. This returns one jsonb value with only the fields the profile
-- statistics use, for the rider's visible classified rides.
CREATE OR REPLACE FUNCTION get_profile_rides(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'strava_activity_id', r.strava_activity_id,
    'name', r.name,
    'ride_date', r.ride_date,
    'start_date', r.start_date,
    'route_category', r.route_category,
    'distance_meters', r.distance_meters,
    'elevation_gain_meters', r.elevation_gain_meters,
    'moving_time_seconds', r.moving_time_seconds,
    'average_speed_mps', r.average_speed_mps
  ) ORDER BY r.ride_date DESC, r.id), '[]'::jsonb)
  FROM rides r
  WHERE r.user_id = p_user_id
    AND r.route_category IS NOT NULL
    AND NOT coalesce(r.is_hidden, false)
    AND NOT coalesce(r.is_private, false)
$$;

GRANT EXECUTE ON FUNCTION get_profile_rides(uuid) TO anon, authenticated, service_role;
