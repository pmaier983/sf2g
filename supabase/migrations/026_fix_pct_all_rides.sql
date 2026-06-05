-- ============================================================
-- Migration 026: Fix % Dist / % Elev — use ALL rides as denominator
-- ============================================================
-- Previously, total_distance_meters and total_elevation_meters only
-- summed rides from "active SF2G years" (calendar years with ≥1
-- valid SF2G ride). This caused the percentage to be ~100% for most
-- riders because most of their non-SF2G rides happen in the same
-- years as their SF2G rides.
--
-- Now, total_distance_meters and total_elevation_meters sum ALL rides
-- unconditionally, so the percentage accurately shows what fraction
-- of a rider's overall cycling is SF2G commuting.

-- 1. Recreate the materialized view (remove sf2g_years CTE)
DROP MATERIALIZED VIEW IF EXISTS leaderboard_view;

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
  -- SF2G-only distance/elevation (numerator)
  COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_elevation_meters,
  -- ALL rides distance/elevation (denominator for % dist/elev)
  COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
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

-- 2. Recreate the date-range RPC function
-- (Already uses SUM without sf2g_years filter, but recreate to ensure
-- the signature matches after the DROP FUNCTION in migration 023.)
DROP FUNCTION IF EXISTS get_leaderboard_by_date_range(date, date, boolean);

CREATE OR REPLACE FUNCTION get_leaderboard_by_date_range(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_exclude_weekends BOOLEAN DEFAULT TRUE
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
    -- ALL rides in the date window (denominator for % dist/elev)
    COALESCE(SUM(r.distance_meters), 0)::DOUBLE PRECISION AS total_distance_meters,
    COALESCE(SUM(r.elevation_gain_meters), 0)::DOUBLE PRECISION AS total_elevation_meters,
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
  LEFT JOIN rides r ON u.id = r.user_id
    AND (p_date_from IS NULL OR r.ride_date >= p_date_from)
    AND (p_date_to IS NULL OR r.ride_date <= p_date_to)
    AND (NOT p_exclude_weekends OR EXTRACT(DOW FROM r.ride_date) NOT IN (0, 6))
  GROUP BY u.id, u.display_name, u.avatar_url, u.username
  HAVING COUNT(r.id) > 0;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
