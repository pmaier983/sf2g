-- ============================================================
-- Migration 012: Add wind data to rides
-- ============================================================
-- Adds wind/tailwind columns to rides table and updates
-- leaderboard_view + get_leaderboard_by_date_range with
-- avg_tailwind_ms.

-- 1. Add wind columns to rides table (IF NOT EXISTS for idempotency)
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS wind_speed_ms real,
  ADD COLUMN IF NOT EXISTS wind_direction_deg real,
  ADD COLUMN IF NOT EXISTS wind_gust_ms real,
  ADD COLUMN IF NOT EXISTS ride_bearing_deg real,
  ADD COLUMN IF NOT EXISTS tailwind_component_ms real,
  ADD COLUMN IF NOT EXISTS crosswind_component_ms real,
  ADD COLUMN IF NOT EXISTS wind_data_source text;

-- 2. Recreate leaderboard_view with avg_tailwind_ms
DROP MATERIALIZED VIEW IF EXISTS leaderboard_view CASCADE;

CREATE MATERIALIZED VIEW leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,
  COUNT(r.id) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS sf2g_total,
  COUNT(r.id) AS total_rides,
  COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'fleaway') AS fleaway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'mebw') AS mebw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'febw') AS febw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'other') AS other_count,
  COALESCE(AVG(r.average_speed_mps) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS avg_speed_mps,
  COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_elevation_meters,
  COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
  COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date::date)) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS active_years,
  MAX(r.ride_date) AS last_ride_date,
  MIN(r.ride_date) AS first_ride_date,
  COALESCE(
    AVG(r.tailwind_component_ms) FILTER (
      WHERE r.route_category IS NOT NULL
      AND r.route_category != 'other'
      AND r.tailwind_component_ms IS NOT NULL
    ), 0
  ) AS avg_tailwind_ms
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username;

CREATE UNIQUE INDEX idx_leaderboard_view_user_id ON leaderboard_view(user_id);

-- 3. Drop and recreate get_leaderboard_by_date_range with avg_tailwind_ms
-- (DROP first because CREATE OR REPLACE cannot change the return type)
DROP FUNCTION IF EXISTS get_leaderboard_by_date_range(date, date);

CREATE OR REPLACE FUNCTION get_leaderboard_by_date_range(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  username TEXT,
  sf2g_total BIGINT,
  total_rides BIGINT,
  bayway_count BIGINT,
  skyline_count BIGINT,
  hmbw_count BIGINT,
  royale_count BIGINT,
  fleaway_count BIGINT,
  mebw_count BIGINT,
  febw_count BIGINT,
  other_count BIGINT,
  avg_speed_mps DOUBLE PRECISION,
  sf2g_distance_meters DOUBLE PRECISION,
  sf2g_elevation_meters DOUBLE PRECISION,
  total_distance_meters DOUBLE PRECISION,
  total_elevation_meters DOUBLE PRECISION,
  active_years BIGINT,
  last_ride_date TIMESTAMPTZ,
  first_ride_date TIMESTAMPTZ,
  avg_tailwind_ms DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.display_name,
    u.avatar_url,
    u.username,
    COUNT(r.id) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS sf2g_total,
    COUNT(r.id) AS total_rides,
    COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'fleaway') AS fleaway_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'mebw') AS mebw_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'febw') AS febw_count,
    COUNT(r.id) FILTER (WHERE r.route_category = 'other') AS other_count,
    COALESCE(AVG(r.average_speed_mps) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS avg_speed_mps,
    COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_distance_meters,
    COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_elevation_meters,
    COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
    COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
    COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date::date)) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS active_years,
    MAX(r.ride_date) AS last_ride_date,
    MIN(r.ride_date) AS first_ride_date,
    COALESCE(
      AVG(r.tailwind_component_ms) FILTER (
        WHERE r.route_category IS NOT NULL
        AND r.route_category != 'other'
        AND r.tailwind_component_ms IS NOT NULL
      ), 0
    )::DOUBLE PRECISION AS avg_tailwind_ms
  FROM users u
  LEFT JOIN rides r ON u.id = r.user_id
    AND (p_date_from IS NULL OR r.ride_date::date >= p_date_from)
    AND (p_date_to IS NULL OR r.ride_date::date <= p_date_to)
  GROUP BY u.id, u.display_name, u.avatar_url, u.username
  HAVING COUNT(r.id) > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Refresh the view
SELECT refresh_leaderboard();
