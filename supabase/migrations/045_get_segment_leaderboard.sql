-- ============================================================
-- Migration 045: get_segment_leaderboard(q jsonb)
-- (rework phase 07b — the Skyline segment board)
-- ============================================================
-- Deploy order: apply after 043 (segments, segment_efforts,
-- users.segment_board_opt_in) and before deploying the Worker that contains
-- 07b; /segments calls this function. Numbered 045 because 044 is taken by
-- phase 08 (044_app_errors_and_monthly_reports.sql); the two are independent.
--
-- The only read path to segment_efforts (no anon/authenticated grant or
-- policy exists on that table). Ranks opted-in riders on corridor segments
-- by each rider's best elapsed time and returns the segment board and the
-- "Skyline crown" in one JSON document. The only users columns that leave
-- the function are user_id, display_name and avatar_url.
--
-- q keys (all optional; app/lib/segment-query.ts validates them):
--   corridor     'skyline'                     default 'skyline'
--   terrain      'all' | 'climb' | 'flat'      default 'all'
--   direction    'south' | 'north' | 'both'    default 'south'
--   date_from    'YYYY-MM-DD' | null           default null (all time)
--   date_to      'YYYY-MM-DD' | null           default null
--   top          int 1–50                      default 10 (riders per segment)
--   min_riders   int                           default 3 (SEGMENT_MIN_RIDERS)
CREATE OR REPLACE FUNCTION get_segment_leaderboard(q jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
WITH p AS (
  SELECT
    coalesce(q ->> 'corridor', 'skyline') AS corridor,
    coalesce(q ->> 'terrain', 'all') AS terrain,
    coalesce(q ->> 'direction', 'south') AS direction,
    nullif(q ->> 'date_from', '')::date AS date_from,
    nullif(q ->> 'date_to', '')::date AS date_to,
    least(greatest(coalesce((q ->> 'top')::int, 10), 1), 50) AS top_n,
    greatest(coalesce((q ->> 'min_riders')::int, 3), 1) AS min_riders
),
eligible_efforts AS (
  SELECT
    e.segment_id,
    e.user_id,
    e.elapsed_time_seconds,
    e.start_date,
    e.kom_rank,
    r.ride_date,
    r.strava_activity_id
  FROM segment_efforts e
  JOIN rides r ON r.id = e.ride_id
  JOIN users u ON u.id = e.user_id
  JOIN segments s ON s.id = e.segment_id
  CROSS JOIN p
  WHERE u.segment_board_opt_in
    AND u.deauthorized_at IS NULL
    AND r.is_private IS NOT TRUE
    AND s.corridor = p.corridor
    AND NOT s.hidden
    AND s.terrain <> 'descent'
    AND s.distance_meters >= 300   -- SEGMENT_MIN_DISTANCE_M
    AND NOT s.hazardous
    AND (p.terrain = 'all' OR s.terrain = p.terrain)
    AND (p.direction = 'both' OR s.direction = p.direction)
    AND (p.date_from IS NULL OR r.ride_date >= p.date_from)
    AND (p.date_to IS NULL OR r.ride_date <= p.date_to)
),
best_effort AS (
  SELECT DISTINCT ON (segment_id, user_id)
    segment_id,
    user_id,
    elapsed_time_seconds AS best_seconds,
    ride_date AS best_date,
    strava_activity_id
  FROM eligible_efforts
  ORDER BY segment_id, user_id, elapsed_time_seconds, start_date
),
effort_stats AS (
  SELECT segment_id, user_id, count(*) AS effort_count, min(kom_rank) AS kom_rank
  FROM eligible_efforts
  GROUP BY segment_id, user_id
),
best AS (
  SELECT b.*, st.effort_count, st.kom_rank
  FROM best_effort b
  JOIN effort_stats st USING (segment_id, user_id)
),
ranked_all AS (
  SELECT
    b.*,
    dense_rank() OVER (PARTITION BY b.segment_id ORDER BY b.best_seconds) AS rank,
    count(*) OVER (PARTITION BY b.segment_id) AS rider_count,
    round(coalesce(s.overall_seconds, s.kom_seconds)::numeric / b.best_seconds, 3) AS pct_of_kom
  FROM best b
  JOIN segments s ON s.id = b.segment_id
),
ranked AS (
  SELECT ra.*, u.display_name, u.avatar_url
  FROM ranked_all ra
  JOIN users u ON u.id = ra.user_id
  CROSS JOIN p
  WHERE ra.rider_count >= p.min_riders
),
shown AS (
  SELECT s.*, x.rider_count
  FROM segments s
  JOIN (SELECT DISTINCT segment_id, rider_count FROM ranked) x ON x.segment_id = s.id
),
segment_json AS (
  SELECT
    s.curated_rank,
    s.rider_count,
    s.name,
    s.id,
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'distance_meters', s.distance_meters,
      'average_grade', s.average_grade,
      'terrain', s.terrain,
      'direction', s.direction,
      'kom_seconds', s.kom_seconds,
      'qom_seconds', s.qom_seconds,
      'curated_rank', s.curated_rank,
      'rider_count', s.rider_count,
      'riders', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', r.user_id,
                 'display_name', r.display_name,
                 'avatar_url', r.avatar_url,
                 'best_seconds', r.best_seconds,
                 'best_date', r.best_date,
                 'strava_activity_id', r.strava_activity_id,
                 'rank', r.rank,
                 'pct_of_kom', r.pct_of_kom,
                 'kom_rank', r.kom_rank,
                 'effort_count', r.effort_count
               ) ORDER BY r.rank, r.best_date, r.user_id), '[]'::jsonb)
        FROM (
          SELECT * FROM ranked r2
          WHERE r2.segment_id = s.id
          ORDER BY r2.rank, r2.best_date, r2.user_id
          LIMIT (SELECT top_n FROM p)
        ) r
      )
    ) AS doc
  FROM shown s
),
totals AS (
  SELECT count(*)::int AS segments_total FROM shown
),
crown AS (
  SELECT
    r.user_id,
    min(r.display_name) AS display_name,
    min(r.avatar_url) AS avatar_url,
    count(*) FILTER (WHERE r.rank = 1)::int AS sf2g_koms,
    count(*) FILTER (WHERE r.rank <= 3)::int AS podiums,
    count(*) FILTER (WHERE r.kom_rank IS NOT NULL)::int AS strava_top10s,
    count(*)::int AS segments_ridden,
    sum(greatest(0, 11 - r.rank))::int AS points,
    round(avg(r.pct_of_kom), 3) AS mean_pct_of_kom
  FROM ranked r
  GROUP BY r.user_id
),
crown_ranked AS (
  SELECT
    c.*,
    row_number() OVER (
      ORDER BY c.sf2g_koms DESC, c.points DESC, c.display_name, c.user_id
    ) AS rank
  FROM crown c
)
SELECT jsonb_build_object(
  'corridor', (SELECT corridor FROM p),
  'segments_total', (SELECT segments_total FROM totals),
  'segments', coalesce(
    (SELECT jsonb_agg(doc ORDER BY curated_rank NULLS LAST, rider_count DESC, name, id)
     FROM segment_json),
    '[]'::jsonb),
  'crown', coalesce(
    (SELECT jsonb_agg(jsonb_build_object(
              'user_id', c.user_id,
              'display_name', c.display_name,
              'avatar_url', c.avatar_url,
              'rank', c.rank,
              'sf2g_koms', c.sf2g_koms,
              'podiums', c.podiums,
              'strava_top10s', c.strava_top10s,
              'segments_ridden', c.segments_ridden,
              'segments_total', t.segments_total,
              'points', c.points,
              'mean_pct_of_kom', c.mean_pct_of_kom
            ) ORDER BY c.rank)
     FROM crown_ranked c CROSS JOIN totals t),
    '[]'::jsonb)
)
$$;

REVOKE EXECUTE ON FUNCTION get_segment_leaderboard(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_segment_leaderboard(jsonb) TO anon, authenticated, service_role;
