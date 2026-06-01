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

CREATE OR REPLACE FUNCTION refresh_route_speed_leaderboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY route_speed_leaderboard;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
