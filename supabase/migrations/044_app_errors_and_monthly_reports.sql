-- ============================================================
-- Migration 044: error capture + monthly report (rework phase 08)
-- ============================================================
-- Deploy order: apply BEFORE the phase 08 app version (it writes to these
-- tables). Independent of 043 (segments); either may land first.
--
-- 1. app_errors       — every server-side failure the Worker catches
--                       (server functions, API routes, Cron ticks). Workers
--                       logs on the Free plan keep three days; this keeps 90.
-- 2. monthly_reports  — one row per month: the data, the rendered email and
--                       whether it was sent. The Cron job is idempotent on it.
-- 3. get_monthly_report(month)  — every number in the email, one SQL call.
-- 4. get_error_groups(since, n) — recent errors grouped for DevTools.
-- 5. prune_app_errors(keep)     — retention, run by the monthly job.
--
-- Everything here is service-role only; nothing is reachable from the browser.

-- ------------------------------------------------------------
-- 1. app_errors
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_errors (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- where it happened: "fn:fetchLeaderboard", "scheduled", "api/cron", …
  scope text NOT NULL,
  message text NOT NULL,
  stack text,
  -- stable hash of scope + normalized message, for grouping
  fingerprint text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid,
  request_url text
);

CREATE INDEX IF NOT EXISTS idx_app_errors_occurred ON app_errors (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_fingerprint ON app_errors (fingerprint, occurred_at DESC);

ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_errors FROM anon, authenticated;
GRANT ALL ON app_errors TO service_role;
GRANT USAGE ON SEQUENCE app_errors_id_seq TO service_role;

-- ------------------------------------------------------------
-- 2. monthly_reports
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_reports (
  -- first day of the reported month (LA calendar)
  month date PRIMARY KEY,
  subject text NOT NULL,
  html text NOT NULL,
  text text NOT NULL,
  data jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_to text,
  sent_at timestamptz,
  send_error text
);

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON monthly_reports FROM anon, authenticated;
GRANT ALL ON monthly_reports TO service_role;

-- ------------------------------------------------------------
-- 3. get_monthly_report
-- ------------------------------------------------------------
-- Everything the monthly email shows, for p_month (first day of a month,
-- LA calendar) and the months it is compared with: the two before it and
-- the same month a year earlier. `months[]` is ordered newest first and
-- carries `offset` (0 = reported month, 1, 2, 12).
--
-- Rides counted are the leaderboard's eligible rides (classified, not
-- hidden, not private; migration 037). "SF2G rides" excludes 'other'.
-- ride_date is already an LA calendar date; timestamps (riders joining,
-- jobs finishing, errors) use LA month boundaries.
CREATE OR REPLACE FUNCTION get_monthly_report(p_month date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH target AS (
  SELECT date_trunc('month', p_month)::date AS m
),
months AS (
  SELECT (t.m - make_interval(months => o.n))::date AS month_start,
         ((t.m - make_interval(months => o.n)) + interval '1 month')::date AS month_end,
         o.n AS month_offset
  FROM target t, (VALUES (0), (1), (2), (12)) AS o(n)
),
month_bounds AS (
  SELECT m.*,
         (m.month_start::timestamp AT TIME ZONE 'America/Los_Angeles') AS ts_start,
         (m.month_end::timestamp AT TIME ZONE 'America/Los_Angeles') AS ts_end
  FROM months m
),
eligible AS (
  SELECT r.user_id, r.ride_date, r.route_category, r.distance_meters,
         r.elevation_gain_meters, r.moving_time_seconds
  FROM rides r
  WHERE r.route_category IS NOT NULL
    AND NOT coalesce(r.is_hidden, false)
    AND NOT coalesce(r.is_private, false)
),
ride_months AS (
  SELECT mb.month_offset,
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
  FROM month_bounds mb
  LEFT JOIN eligible e
    ON e.ride_date >= mb.month_start AND e.ride_date < mb.month_end
  GROUP BY mb.month_offset
),
rider_months AS (
  SELECT mb.month_offset,
    count(u.id) AS new_riders
  FROM month_bounds mb
  LEFT JOIN users u
    ON u.created_at >= mb.ts_start AND u.created_at < mb.ts_end
  GROUP BY mb.month_offset
),
group_months AS (
  SELECT mb.month_offset,
    count(g.id) AS group_rides,
    coalesce(max(g.rider_count), 0) AS biggest_group
  FROM month_bounds mb
  LEFT JOIN group_rides g
    ON g.ride_date >= mb.month_start AND g.ride_date < mb.month_end
  GROUP BY mb.month_offset
),
sync_months AS (
  SELECT mb.month_offset,
    count(j.id) FILTER (WHERE j.status = 'done') AS jobs_done,
    count(j.id) FILTER (WHERE j.status = 'failed') AS jobs_failed
  FROM month_bounds mb
  LEFT JOIN sync_jobs j
    ON j.finished_at >= mb.ts_start AND j.finished_at < mb.ts_end
  GROUP BY mb.month_offset
),
error_months AS (
  SELECT mb.month_offset,
    count(a.id) AS errors
  FROM month_bounds mb
  LEFT JOIN app_errors a
    ON a.occurred_at >= mb.ts_start AND a.occurred_at < mb.ts_end
  GROUP BY mb.month_offset
),
per_month AS (
  SELECT jsonb_build_object(
    'month', to_char(mb.month_start, 'YYYY-MM'),
    'offset', mb.month_offset,
    'sf2g_rides', rm.sf2g_rides,
    'other_rides', rm.other_rides,
    'active_riders', rm.active_riders,
    'sf2g_distance_meters', rm.sf2g_distance_meters,
    'sf2g_elevation_meters', rm.sf2g_elevation_meters,
    'sf2g_moving_seconds', rm.sf2g_moving_seconds,
    'routes', rm.routes,
    'new_riders', um.new_riders,
    'group_rides', gm.group_rides,
    'biggest_group', gm.biggest_group,
    'sync_jobs_done', sm.jobs_done,
    'sync_jobs_failed', sm.jobs_failed,
    'errors', em.errors
  ) AS row, mb.month_offset
  FROM month_bounds mb
  JOIN ride_months rm USING (month_offset)
  JOIN rider_months um USING (month_offset)
  JOIN group_months gm USING (month_offset)
  JOIN sync_months sm USING (month_offset)
  JOIN error_months em USING (month_offset)
),
top_riders AS (
  SELECT e.user_id, u.display_name,
         count(*) AS rides,
         coalesce(sum(e.distance_meters), 0)::double precision AS distance_meters
  FROM eligible e
  JOIN users u ON u.id = e.user_id
  JOIN month_bounds mb ON mb.month_offset = 0
  WHERE e.route_category <> 'other'
    AND e.ride_date >= mb.month_start AND e.ride_date < mb.month_end
  GROUP BY e.user_id, u.display_name
  ORDER BY rides DESC, distance_meters DESC, u.display_name
  LIMIT 5
),
top_errors AS (
  SELECT a.scope, a.fingerprint, min(a.message) AS message,
         count(*) AS count, max(a.occurred_at) AS last_seen
  FROM app_errors a
  JOIN month_bounds mb ON mb.month_offset = 0
  WHERE a.occurred_at >= mb.ts_start AND a.occurred_at < mb.ts_end
  GROUP BY a.scope, a.fingerprint
  ORDER BY count DESC, last_seen DESC
  LIMIT 5
),
top_sync_errors AS (
  SELECT left(j.last_error, 160) AS message, count(*) AS count
  FROM sync_jobs j
  JOIN month_bounds mb ON mb.month_offset = 0
  WHERE j.status = 'failed'
    AND j.finished_at >= mb.ts_start AND j.finished_at < mb.ts_end
  GROUP BY left(j.last_error, 160)
  ORDER BY count DESC
  LIMIT 3
)
SELECT jsonb_build_object(
  'month', to_char((SELECT m FROM target), 'YYYY-MM'),
  'generated_at', now(),
  'months', (SELECT jsonb_agg(row ORDER BY month_offset) FROM per_month),
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

REVOKE EXECUTE ON FUNCTION get_monthly_report(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_report(date) TO service_role;

-- ------------------------------------------------------------
-- 4. get_error_groups — DevTools "Recent errors"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_error_groups(
  p_since interval DEFAULT interval '7 days',
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  fingerprint text,
  scope text,
  message text,
  count bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  sample_stack text,
  sample_context jsonb,
  sample_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT * FROM app_errors WHERE occurred_at >= now() - p_since
  ),
  latest AS (
    SELECT DISTINCT ON (fingerprint) fingerprint, message, stack, context, request_url
    FROM recent
    ORDER BY fingerprint, occurred_at DESC
  )
  SELECT r.fingerprint,
         min(r.scope) AS scope,
         l.message,
         count(*) AS count,
         min(r.occurred_at) AS first_seen,
         max(r.occurred_at) AS last_seen,
         l.stack AS sample_stack,
         l.context AS sample_context,
         l.request_url AS sample_url
  FROM recent r
  JOIN latest l USING (fingerprint)
  GROUP BY r.fingerprint, l.message, l.stack, l.context, l.request_url
  ORDER BY max(r.occurred_at) DESC
  LIMIT greatest(p_limit, 1);
$$;

REVOKE EXECUTE ON FUNCTION get_error_groups(interval, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_error_groups(interval, int) TO service_role;

-- ------------------------------------------------------------
-- 5. prune_app_errors — retention (run by the monthly job)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_app_errors(p_keep interval DEFAULT interval '90 days')
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  DELETE FROM app_errors WHERE occurred_at < now() - p_keep;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION prune_app_errors(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prune_app_errors(interval) TO service_role;

NOTIFY pgrst, 'reload schema';
