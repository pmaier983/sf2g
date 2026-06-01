-- ============================================================
-- Leaderboard Rework: fix constraints, add sf2g_total, fix avg speed
-- ============================================================
-- 1. Fix rides.route_category CHECK constraint to include ALL 8 categories
-- 2. Rebuild leaderboard_view with:
--    - sf2g_total (rides where route_category != 'other')
--    - avg_speed_mps filtered to SF2G rides only
--    - all 8 per-route count columns
--    - sf2g_distance/elevation, total_distance/elevation
--    - active_years, first/last ride dates
-- 3. Rebuild route_speed_leaderboard to ensure all non-other routes included

-- ============================================================
-- 1. Fix rides.route_category CHECK constraint
-- ============================================================
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_route_category_check;
ALTER TABLE rides ADD CONSTRAINT rides_route_category_check
  CHECK (route_category IN ('bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other'));

-- ============================================================
-- 2. Rebuild leaderboard_view materialized view
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS leaderboard_view;

CREATE MATERIALIZED VIEW leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,
  -- SF2G total: rides that are NOT 'other' and NOT null
  COUNT(r.id) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other') AS sf2g_total,
  -- Total rides: ALL rides (kept for backwards compat)
  COUNT(r.id) AS total_rides,
  -- Per-route counts (all 8 categories)
  COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'fleaway') AS fleaway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'mebw') AS mebw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'febw') AS febw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'other') AS other_count,
  -- Average speed: SF2G rides only (exclude 'other' and null)
  COALESCE(AVG(r.average_speed_mps) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS avg_speed_mps,
  -- SF2G distance/elevation
  COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category IS NOT NULL AND r.route_category != 'other'), 0) AS sf2g_elevation_meters,
  -- Total distance/elevation (all rides)
  COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
  -- Active years
  COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date::date)) AS active_years,
  -- Date range
  MAX(r.ride_date) AS last_ride_date,
  MIN(r.ride_date) AS first_ride_date
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_leaderboard_view_user_id ON leaderboard_view(user_id);

-- ============================================================
-- 3. Rebuild route_speed_leaderboard
-- ============================================================
-- The existing view in migration 005 already filters
-- WHERE route_category IS NOT NULL AND route_category != 'other'
-- which correctly includes all non-other routes (including fleaway/mebw/febw).
-- Rebuild it to pick up any schema changes and ensure consistency.
DROP MATERIALIZED VIEW IF EXISTS route_speed_leaderboard;

CREATE MATERIALIZED VIEW route_speed_leaderboard AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,
  r.route_category,
  COUNT(r.id)::int AS route_ride_count,
  AVG(r.average_speed_mps) AS avg_speed_mps,
  MAX(r.average_speed_mps) AS max_speed_mps,
  AVG(r.distance_meters) AS avg_distance_meters,
  AVG(r.elevation_gain_meters) AS avg_elevation_meters,
  MAX(r.ride_date) AS last_ride_date
FROM users u
JOIN rides r ON u.id = r.user_id
WHERE r.route_category IS NOT NULL
  AND r.route_category != 'other'
  AND r.average_speed_mps IS NOT NULL
GROUP BY u.id, u.display_name, u.avatar_url, u.username, r.route_category
HAVING COUNT(r.id) >= 3;

CREATE UNIQUE INDEX idx_route_speed_lb_user_route
  ON route_speed_leaderboard(user_id, route_category);

-- Recreate the refresh function (dropped with the view)
CREATE OR REPLACE FUNCTION refresh_route_speed_leaderboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY route_speed_leaderboard;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
