-- ============================================================
-- Migration 047: weekly reports (generalizes the monthly report)
-- ============================================================
-- Deploy order: apply together with the app version that adds the weekly
-- report, migration first. The old app only touches these objects from the
-- monthly Cron (the 1st, 16:00 UTC) and DevTools → Monthly Report, so a short
-- gap is harmless; do not leave the old app running across the 1st.
--
-- 1. monthly_reports → reports, keyed by (kind, period_start) where kind is
--    'week' (period_start = the Monday) or 'month' (the 1st). Existing rows
--    become kind 'month'.
-- 2. get_monthly_report(month) → get_report(kind, start): the same numbers
--    for a Monday–Sunday week or a calendar month, compared with the two
--    periods before and the period a year earlier (12 months / 52 weeks).

-- ------------------------------------------------------------
-- 1. reports
-- ------------------------------------------------------------
ALTER TABLE monthly_reports RENAME TO reports;
ALTER TABLE reports RENAME COLUMN month TO period_start;
ALTER TABLE reports
  ADD COLUMN kind text NOT NULL DEFAULT 'month'
    CHECK (kind IN ('week', 'month'));
ALTER TABLE reports ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE reports DROP CONSTRAINT monthly_reports_pkey;
ALTER TABLE reports ADD PRIMARY KEY (kind, period_start);

COMMENT ON TABLE reports IS
  'One row per emailed report: kind week (period_start = Monday, LA calendar) or month (the 1st).';

-- RLS and grants carry over with the rename (service_role only).

-- ------------------------------------------------------------
-- 2. get_report
-- ------------------------------------------------------------
-- Everything the email shows, for the period containing p_start (snapped to
-- its Monday or its 1st, LA calendar) and the periods it is compared with:
-- the two before it and the one a year earlier. `periods[]` is ordered
-- newest first and carries `offset` (0 = reported period, 1, 2, and 12 for a
-- month / 52 for a week). Period keys are 'YYYY-MM' for months and the
-- Monday 'YYYY-MM-DD' for weeks.
--
-- Rides counted are the leaderboard's eligible rides (classified, not
-- hidden, not private; migration 037). "SF2G rides" excludes 'other'.
-- ride_date is already an LA calendar date; timestamps (riders joining,
-- jobs finishing, errors) use LA period boundaries.
DROP FUNCTION IF EXISTS get_monthly_report(date);

CREATE OR REPLACE FUNCTION get_report(p_kind text, p_start date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH params AS (
  SELECT
    CASE p_kind
      WHEN 'week'  THEN date_trunc('week',  p_start)::date   -- ISO: Monday
      WHEN 'month' THEN date_trunc('month', p_start)::date
    END AS start,
    CASE p_kind
      WHEN 'week'  THEN interval '1 week'
      WHEN 'month' THEN interval '1 month'
    END AS len,
    CASE p_kind WHEN 'week' THEN 52 WHEN 'month' THEN 12 END AS year_ago,
    CASE p_kind WHEN 'week' THEN 'YYYY-MM-DD' WHEN 'month' THEN 'YYYY-MM' END AS key_format
),
periods AS (
  SELECT (p.start - o.n * p.len)::date AS period_start,
         (p.start - o.n * p.len + p.len)::date AS period_end,
         o.n AS period_offset
  FROM params p
  CROSS JOIN LATERAL (VALUES (0), (1), (2), (p.year_ago)) AS o(n)
),
period_bounds AS (
  SELECT pr.*,
         (pr.period_start::timestamp AT TIME ZONE 'America/Los_Angeles') AS ts_start,
         (pr.period_end::timestamp AT TIME ZONE 'America/Los_Angeles') AS ts_end
  FROM periods pr
),
eligible AS (
  SELECT r.user_id, r.ride_date, r.route_category, r.distance_meters,
         r.elevation_gain_meters, r.moving_time_seconds
  FROM rides r
  WHERE r.route_category IS NOT NULL
    AND NOT coalesce(r.is_hidden, false)
    AND NOT coalesce(r.is_private, false)
),
ride_periods AS (
  SELECT pb.period_offset,
    count(e.user_id) FILTER (WHERE e.route_category <> 'other') AS sf2g_rides,
    count(e.user_id) FILTER (WHERE e.route_category = 'other') AS other_rides,
    count(DISTINCT e.user_id) FILTER (WHERE e.route_category <> 'other') AS active_riders,
    coalesce(sum(e.distance_meters) FILTER (WHERE e.route_category <> 'other'), 0)::double precision AS sf2g_distance_meters,
    coalesce(sum(e.elevation_gain_meters) FILTER (WHERE e.route_category <> 'other'), 0)::double precision AS sf2g_elevation_meters,
    coalesce(sum(e.moving_time_seconds) FILTER (WHERE e.route_category <> 'other'), 0)::bigint AS sf2g_moving_seconds,
    jsonb_build_object(
      'bayway',  count(e.user_id) FILTER (WHERE e.route_category = 'bayway'),
      'skyline', count(e.user_id) FILTER (WHERE e.route_category = 'skyline'),
      'hmbw',    count(e.user_id) FILTER (WHERE e.route_category = 'hmbw'),
      'royale',  count(e.user_id) FILTER (WHERE e.route_category = 'royale'),
      'fleaway', count(e.user_id) FILTER (WHERE e.route_category = 'fleaway'),
      'mebw',    count(e.user_id) FILTER (WHERE e.route_category = 'mebw'),
      'febw',    count(e.user_id) FILTER (WHERE e.route_category = 'febw')
    ) AS routes
  FROM period_bounds pb
  LEFT JOIN eligible e
    ON e.ride_date >= pb.period_start AND e.ride_date < pb.period_end
  GROUP BY pb.period_offset
),
rider_periods AS (
  SELECT pb.period_offset,
    count(u.id) AS new_riders
  FROM period_bounds pb
  LEFT JOIN users u
    ON u.created_at >= pb.ts_start AND u.created_at < pb.ts_end
  GROUP BY pb.period_offset
),
group_periods AS (
  SELECT pb.period_offset,
    count(g.id) AS group_rides,
    coalesce(max(g.rider_count), 0) AS biggest_group
  FROM period_bounds pb
  LEFT JOIN group_rides g
    ON g.ride_date >= pb.period_start AND g.ride_date < pb.period_end
  GROUP BY pb.period_offset
),
sync_periods AS (
  SELECT pb.period_offset,
    count(j.id) FILTER (WHERE j.status = 'done') AS jobs_done,
    count(j.id) FILTER (WHERE j.status = 'failed') AS jobs_failed
  FROM period_bounds pb
  LEFT JOIN sync_jobs j
    ON j.finished_at >= pb.ts_start AND j.finished_at < pb.ts_end
  GROUP BY pb.period_offset
),
error_periods AS (
  SELECT pb.period_offset,
    count(a.id) AS errors
  FROM period_bounds pb
  LEFT JOIN app_errors a
    ON a.occurred_at >= pb.ts_start AND a.occurred_at < pb.ts_end
  GROUP BY pb.period_offset
),
per_period AS (
  SELECT jsonb_build_object(
    'period', to_char(pb.period_start, (SELECT key_format FROM params)),
    'offset', pb.period_offset,
    'sf2g_rides', rp.sf2g_rides,
    'other_rides', rp.other_rides,
    'active_riders', rp.active_riders,
    'sf2g_distance_meters', rp.sf2g_distance_meters,
    'sf2g_elevation_meters', rp.sf2g_elevation_meters,
    'sf2g_moving_seconds', rp.sf2g_moving_seconds,
    'routes', rp.routes,
    'new_riders', up.new_riders,
    'group_rides', gp.group_rides,
    'biggest_group', gp.biggest_group,
    'sync_jobs_done', sp.jobs_done,
    'sync_jobs_failed', sp.jobs_failed,
    'errors', ep.errors
  ) AS row, pb.period_offset
  FROM period_bounds pb
  JOIN ride_periods rp USING (period_offset)
  JOIN rider_periods up USING (period_offset)
  JOIN group_periods gp USING (period_offset)
  JOIN sync_periods sp USING (period_offset)
  JOIN error_periods ep USING (period_offset)
),
top_riders AS (
  SELECT e.user_id, u.display_name,
         count(*) AS rides,
         coalesce(sum(e.distance_meters), 0)::double precision AS distance_meters
  FROM eligible e
  JOIN users u ON u.id = e.user_id
  JOIN period_bounds pb ON pb.period_offset = 0
  WHERE e.route_category <> 'other'
    AND e.ride_date >= pb.period_start AND e.ride_date < pb.period_end
  GROUP BY e.user_id, u.display_name
  ORDER BY rides DESC, distance_meters DESC, u.display_name
  LIMIT 5
),
top_errors AS (
  SELECT a.scope, a.fingerprint, min(a.message) AS message,
         count(*) AS count, max(a.occurred_at) AS last_seen
  FROM app_errors a
  JOIN period_bounds pb ON pb.period_offset = 0
  WHERE a.occurred_at >= pb.ts_start AND a.occurred_at < pb.ts_end
  GROUP BY a.scope, a.fingerprint
  ORDER BY count DESC, last_seen DESC
  LIMIT 5
),
top_sync_errors AS (
  SELECT left(j.last_error, 160) AS message, count(*) AS count
  FROM sync_jobs j
  JOIN period_bounds pb ON pb.period_offset = 0
  WHERE j.status = 'failed'
    AND j.finished_at >= pb.ts_start AND j.finished_at < pb.ts_end
  GROUP BY left(j.last_error, 160)
  ORDER BY count DESC
  LIMIT 3
)
SELECT jsonb_build_object(
  'kind', p_kind,
  'period', to_char((SELECT start FROM params), (SELECT key_format FROM params)),
  'generated_at', now(),
  'periods', (SELECT jsonb_agg(row ORDER BY period_offset) FROM per_period),
  'top_riders', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'display_name', display_name,
      'rides', rides, 'distance_meters', distance_meters)
      ORDER BY rides DESC, distance_meters DESC, display_name) FROM top_riders), '[]'::jsonb),
  'riders', jsonb_build_object(
    'connected', (SELECT count(*) FROM users
                  WHERE deauthorized_at IS NULL AND strava_refresh_token <> ''),
    'needs_reauth', (SELECT count(*) FROM users
                     WHERE deauthorized_at IS NULL AND needs_reauth),
    'synced_last_7_days', (SELECT count(*) FROM users
                           WHERE deauthorized_at IS NULL
                             AND last_sync_success_at >= now() - interval '7 days'),
    'never_synced', (SELECT count(*) FROM users
                     WHERE deauthorized_at IS NULL AND strava_refresh_token <> ''
                       AND last_sync_success_at IS NULL)
  ),
  'sync', jsonb_build_object(
    'open_jobs', (SELECT count(*) FROM sync_jobs WHERE status IN ('queued', 'running')),
    'failed_jobs_open', (SELECT count(*) FROM sync_jobs WHERE status = 'failed'),
    'top_errors', coalesce((SELECT jsonb_agg(jsonb_build_object('message', message, 'count', count)
                            ORDER BY count DESC) FROM top_sync_errors), '[]'::jsonb)
  ),
  'errors', jsonb_build_object(
    'top', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'scope', scope, 'fingerprint', fingerprint, 'message', message,
        'count', count, 'last_seen', last_seen)
        ORDER BY count DESC, last_seen DESC) FROM top_errors), '[]'::jsonb)
  ),
  'all_time', jsonb_build_object(
    'sf2g_rides', (SELECT count(*) FROM eligible WHERE route_category <> 'other'),
    'riders_with_rides', (SELECT count(DISTINCT user_id) FROM eligible WHERE route_category <> 'other'),
    'sf2g_distance_meters', (SELECT coalesce(sum(distance_meters), 0)::double precision
                             FROM eligible WHERE route_category <> 'other')
  )
);
$$;

REVOKE EXECUTE ON FUNCTION get_report(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_report(text, date) TO service_role;

NOTIFY pgrst, 'reload schema';
