-- ============================================================
-- Add Fleaway/MEBW/FEBW route counts + active_years to leaderboard_view
-- ============================================================
-- Extends the leaderboard materialized view to include:
--   - fleaway_count, mebw_count, febw_count (new route corridors)
--   - active_years (distinct years with at least 1 ride)

DROP MATERIALIZED VIEW IF EXISTS leaderboard_view;

CREATE MATERIALIZED VIEW leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,
  COUNT(r.id) AS total_rides,
  COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'fleaway') AS fleaway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'mebw') AS mebw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'febw') AS febw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'other') AS other_count,
  COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
  COALESCE(SUM(r.distance_meters) FILTER (WHERE r.route_category != 'other'), 0) AS sf2g_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.route_category != 'other'), 0) AS sf2g_elevation_meters,
  COALESCE(AVG(r.average_speed_mps), 0) AS avg_speed_mps,
  COUNT(DISTINCT EXTRACT(YEAR FROM r.ride_date::date)) AS active_years,
  MAX(r.ride_date) AS last_ride_date,
  MIN(r.ride_date) AS first_ride_date
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_leaderboard_view_user_id ON leaderboard_view(user_id);
