-- ============================================================
-- Migration 052: get_segment_matrix — every rider's PR on every selectable
-- segment of one route, for the cumulative leaderboard
-- (rework phase 09c — docs/rework/phase-09-cumulative-segments.md §4.6)
-- ============================================================
-- Deploy order: after 051, before the Worker that contains 09c.
--
-- The browser computes totals, ranks, presets and stats from this matrix,
-- so changing the selection needs no request. With get_segment_leaderboard
-- it is the only read path to segment_bests.
--
-- q: { corridor: 'skyline', direction: 'south' | 'north', year: int | null }
--    year null = all time (fastest over the rider's yearly bests).
--
-- Output:
-- { corridor, direction, year, years: [2026, 2025, …],
--   segments: [{ id, name, distance_meters, average_grade, terrain,
--                along_start_m, along_end_m, start_latlng, end_latlng,
--                kom_seconds, qom_seconds, overall_seconds, xoms_fetched_at,
--                athlete_count, ride_share, curated_rank }],
--   riders:   [{ user_id, display_name, avatar_url }],
--   cells:    [[segIdx, riderIdx, best_seconds, best_date, strava_activity_id,
--               effort_count, first_date, kom_rank]] }
-- Only selectable, visible segments; riders who did not hide their times;
-- bests from rides that are neither private nor hidden.

CREATE FUNCTION get_segment_matrix(q jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
WITH p AS (
  SELECT
    coalesce(q ->> 'corridor', 'skyline') AS corridor,
    CASE WHEN q ->> 'direction' = 'north' THEN 'north' ELSE 'south' END AS direction,
    nullif(q ->> 'year', '')::int AS year
),
seg AS (
  SELECT s.*
  FROM segments s CROSS JOIN p
  WHERE s.selectable AND NOT s.hidden AND s.corridor = p.corridor AND s.direction = p.direction
),
totals AS (
  SELECT count(*)::int AS n FROM rides, p
  WHERE route_category = p.corridor
    AND segment_efforts_fetched_at IS NOT NULL
    AND coalesce(commute_direction, 'sf2g') = CASE p.direction WHEN 'north' THEN 'g2sf' ELSE 'sf2g' END
),
eligible AS (
  SELECT b.segment_id, b.user_id, b.year, b.elapsed_time_seconds, b.ride_date,
         b.effort_count, b.first_ride_date, b.kom_rank, r.strava_activity_id
  FROM segment_bests b
  JOIN seg s ON s.id = b.segment_id
  JOIN rides r ON r.id = b.ride_id
  JOIN users u ON u.id = b.user_id
  WHERE NOT u.segment_board_hidden
    AND u.deauthorized_at IS NULL
    AND r.is_private IS NOT TRUE
    AND r.is_hidden IS NOT TRUE
),
years AS (
  SELECT coalesce(jsonb_agg(DISTINCT year ORDER BY year DESC), '[]'::jsonb) AS list FROM eligible
),
in_year AS (
  SELECT e.* FROM eligible e, p WHERE p.year IS NULL OR e.year = p.year
),
best AS (
  SELECT DISTINCT ON (segment_id, user_id)
    segment_id, user_id, elapsed_time_seconds, ride_date, strava_activity_id
  FROM in_year
  ORDER BY segment_id, user_id, elapsed_time_seconds, ride_date
),
stats AS (
  SELECT segment_id, user_id, sum(effort_count)::int AS effort_count,
         min(first_ride_date) AS first_date, min(kom_rank) AS kom_rank
  FROM in_year GROUP BY 1, 2
),
seg_idx AS (
  SELECT s.*, (row_number() OVER (ORDER BY s.along_start_m NULLS LAST, s.id) - 1)::int AS idx
  FROM seg s
),
rider_idx AS (
  SELECT u.id AS user_id, u.display_name, u.avatar_url,
         (row_number() OVER (ORDER BY u.display_name, u.id) - 1)::int AS idx
  FROM users u
  WHERE u.id IN (SELECT DISTINCT user_id FROM best)
)
SELECT jsonb_build_object(
  'corridor', (SELECT corridor FROM p),
  'direction', (SELECT direction FROM p),
  'year', (SELECT year FROM p),
  'years', (SELECT list FROM years),
  'segments', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'distance_meters', s.distance_meters,
      'average_grade', s.average_grade, 'terrain', s.terrain,
      'along_start_m', s.along_start_m, 'along_end_m', s.along_end_m,
      'start_latlng', s.start_latlng, 'end_latlng', s.end_latlng,
      'kom_seconds', s.kom_seconds, 'qom_seconds', s.qom_seconds,
      'overall_seconds', s.overall_seconds, 'xoms_fetched_at', s.xoms_fetched_at,
      'athlete_count', s.athlete_count, 'curated_rank', s.curated_rank,
      'ride_share', CASE WHEN t.n = 0 THEN 0 ELSE round(least(1, s.sf2g_rides::numeric / t.n), 3) END
    ) ORDER BY s.idx)
    FROM seg_idx s CROSS JOIN totals t), '[]'::jsonb),
  'riders', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', r.user_id, 'display_name', r.display_name, 'avatar_url', r.avatar_url
    ) ORDER BY r.idx)
    FROM rider_idx r), '[]'::jsonb),
  'cells', coalesce((
    SELECT jsonb_agg(jsonb_build_array(
      s.idx, r.idx, b.elapsed_time_seconds, b.ride_date, b.strava_activity_id,
      st.effort_count, st.first_date, st.kom_rank
    ) ORDER BY s.idx, b.elapsed_time_seconds, r.idx)
    FROM best b
    JOIN stats st USING (segment_id, user_id)
    JOIN seg_idx s ON s.id = b.segment_id
    JOIN rider_idx r ON r.user_id = b.user_id), '[]'::jsonb)
)
$$;

REVOKE EXECUTE ON FUNCTION get_segment_matrix(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_segment_matrix(jsonb) TO anon, authenticated, service_role;
