-- ============================================================
-- Migration 017: % Dist / % Elev — only count active SF2G years
-- ============================================================
-- total_distance_meters and total_elevation_meters now only sum
-- rides from calendar years where the rider had at least 1
-- valid SF2G ride (route_category IS NOT NULL AND != 'other').
-- This prevents non-SF2G years from diluting the percentage.

-- 1. Recreate the materialized view
DROP MATERIALIZED VIEW IF EXISTS leaderboard_view;

CREATE MATERIALIZED VIEW leaderboard_view AS
WITH sf2g_years AS (
  -- Identify calendar years where each user had ≥1 valid SF2G ride
  SELECT user_id, EXTRACT(YEAR FROM ride_date::date)::INT AS yr
  FROM rides
  WHERE route_category IS NOT NULL AND route_category != 'other'
  GROUP BY user_id, EXTRACT(YEAR FROM ride_date::date)::INT
)
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
  -- Only sum distance/elevation from years with ≥1 SF2G ride
  COALESCE(SUM(r.distance_meters) FILTER (
    WHERE EXTRACT(YEAR FROM r.ride_date::date)::INT IN (SELECT yr FROM sf2g_years sy WHERE sy.user_id = u.id)
  ), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (
    WHERE EXTRACT(YEAR FROM r.ride_date::date)::INT IN (SELECT yr FROM sf2g_years sy WHERE sy.user_id = u.id)
  ), 0) AS total_elevation_meters,
  COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date::date)) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS active_years,
  MAX(r.ride_date) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS last_ride_date,
  MIN(r.ride_date) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS first_ride_date,
  COALESCE(
    AVG(r.tailwind_component_ms) FILTER (
      WHERE r.route_category IS NOT NULL
      AND r.route_category != 'other'
      AND r.tailwind_component_ms IS NOT NULL
    ), 0
  ) AS avg_tailwind_ms
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username
HAVING COUNT(r.id) > 0;

CREATE UNIQUE INDEX ON leaderboard_view (user_id);

-- 2. Recreate the date-range function
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
  last_ride_date TEXT,
  first_ride_date TEXT,
  avg_tailwind_ms DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_rides AS (
    SELECT r.*
    FROM rides r
    WHERE (p_date_from IS NULL OR r.ride_date >= p_date_from)
      AND (p_date_to IS NULL OR r.ride_date <= p_date_to)
  ),
  sf2g_years AS (
    -- Calendar years with ≥1 SF2G ride in the filtered window
    SELECT fr.user_id, EXTRACT(YEAR FROM fr.ride_date)::INT AS yr
    FROM filtered_rides fr
    WHERE fr.route_category IS NOT NULL AND fr.route_category != 'other'
    GROUP BY fr.user_id, EXTRACT(YEAR FROM fr.ride_date)::INT
  )
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
    COALESCE(AVG(r.average_speed_mps) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0)::DOUBLE PRECISION AS avg_speed_mps,
    COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0)::DOUBLE PRECISION AS sf2g_distance_meters,
    COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0)::DOUBLE PRECISION AS sf2g_elevation_meters,
    -- Only sum distance/elevation from years with ≥1 SF2G ride
    COALESCE(SUM(r.distance_meters) FILTER (
      WHERE EXTRACT(YEAR FROM r.ride_date)::INT IN (SELECT yr FROM sf2g_years sy WHERE sy.user_id = u.id)
    ), 0)::DOUBLE PRECISION AS total_distance_meters,
    COALESCE(SUM(r.elevation_gain_meters) FILTER (
      WHERE EXTRACT(YEAR FROM r.ride_date)::INT IN (SELECT yr FROM sf2g_years sy WHERE sy.user_id = u.id)
    ), 0)::DOUBLE PRECISION AS total_elevation_meters,
    COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date)) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS active_years,
    (MAX(r.ride_date) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'))::TEXT AS last_ride_date,
    (MIN(r.ride_date) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'))::TEXT AS first_ride_date,
    COALESCE(
      AVG(r.tailwind_component_ms) FILTER (
        WHERE r.route_category IS NOT NULL
        AND r.route_category != 'other'
        AND r.tailwind_component_ms IS NOT NULL
      ), 0
    )::DOUBLE PRECISION AS avg_tailwind_ms
  FROM users u
  LEFT JOIN filtered_rides r ON u.id = r.user_id
  GROUP BY u.id, u.display_name, u.avatar_url, u.username
  HAVING COUNT(r.id) > 0;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
