-- One-time backfills below can exceed the API roles' 8 s statement timeout.
SET statement_timeout = 0;

-- ============================================================
-- Migration 038: Rides view, All-time, growth chart and community
-- stats as SQL functions (rework phase 03b)
-- ============================================================
-- Every function below used to page whole tables into the Worker and
-- aggregate in JS. They now share one filter (sf2g_filtered_rides) with the
-- Riders leaderboard, so the same chips mean the same thing everywhere.
--
-- Functions that return many rows return a single jsonb value instead, so
-- PostgREST's max_rows (1000) can never silently truncate them.

-- ------------------------------------------------------------
-- 1. Shared filter
-- ------------------------------------------------------------
-- Classified (route_category NOT NULL, incl. 'other'), not hidden, not
-- private, and matching every filter in q:
--   routes, date_from, date_to, exclude_weekends (default true), ppr,
--   reverse, company, user_id
-- Whether 'other' rides count is decided by each caller.
CREATE OR REPLACE FUNCTION sf2g_filtered_rides(q jsonb)
RETURNS SETOF rides
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH p AS (
    SELECT
      coalesce(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(q->'routes', '[]'::jsonb)) x
          WHERE x IN ('bayway','skyline','hmbw','royale','fleaway','mebw','febw','other')),
        '{}'::text[]
      ) AS routes,
      CASE WHEN q->>'date_from' ~ '^\d{4}-\d{2}-\d{2}$' THEN (q->>'date_from')::date END AS date_from,
      CASE WHEN q->>'date_to' ~ '^\d{4}-\d{2}-\d{2}$' THEN (q->>'date_to')::date END AS date_to,
      coalesce((q->>'exclude_weekends')::boolean, true) AS exclude_weekends,
      coalesce((q->>'ppr')::boolean, false) AS ppr,
      coalesce((q->>'reverse')::boolean, false) AS reverse,
      nullif(q->>'company', '') AS company,
      CASE WHEN q->>'user_id' ~ '^[0-9a-fA-F-]{36}$' THEN (q->>'user_id')::uuid END AS user_id
  )
  SELECT r.*
  FROM rides r, p
  WHERE r.route_category IS NOT NULL
    AND NOT coalesce(r.is_hidden, false)
    AND NOT coalesce(r.is_private, false)
    AND (cardinality(p.routes) = 0 OR r.route_category = ANY (p.routes))
    AND (p.company IS NULL OR r.destination_company = p.company)
    AND (p.date_from IS NULL OR r.ride_date >= p.date_from)
    AND (p.date_to IS NULL OR r.ride_date <= p.date_to)
    AND (NOT p.exclude_weekends OR extract(isodow FROM r.ride_date) < 6)
    AND (NOT p.ppr OR r.is_ppr_dawn)
    AND (NOT p.reverse OR r.commute_direction = 'g2sf')
    AND (p.user_id IS NULL OR r.user_id = p.user_id)
$$;

-- 'other' rides count only when asked for (include_other, or 'other' in routes).
CREATE OR REPLACE FUNCTION sf2g_counts_other(q jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce((q->>'include_other')::boolean, false)
      OR coalesce(q->'routes', '[]'::jsonb) ? 'other'
      OR jsonb_array_length(coalesce(q->'routes', '[]'::jsonb)) > 0
$$;
-- (When routes are given explicitly they already decide which categories
-- appear, so 'other' only needs excluding when no routes are selected.)

-- ------------------------------------------------------------
-- 2. get_leaderboard: same output as 037, now on the shared filter
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_leaderboard(q jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  sf2g_total bigint,
  total_rides bigint,
  bayway_count bigint,
  skyline_count bigint,
  hmbw_count bigint,
  royale_count bigint,
  fleaway_count bigint,
  mebw_count bigint,
  febw_count bigint,
  other_count bigint,
  avg_speed_mps double precision,
  median_speed_mps double precision,
  sf2g_distance_meters double precision,
  sf2g_elevation_meters double precision,
  total_distance_meters double precision,
  total_elevation_meters double precision,
  active_years bigint,
  last_ride_date text,
  first_ride_date text,
  avg_tailwind_ms double precision,
  avg_watts double precision,
  median_watts double precision,
  avg_heartrate double precision,
  avg_kilojoules double precision,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH params AS (
  SELECT
    coalesce(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(q->'routes', '[]'::jsonb)) x
        WHERE x IN ('bayway','skyline','hmbw','royale','fleaway','mebw','febw','other')),
      '{}'::text[]
    ) AS routes,
    coalesce((q->>'include_other')::boolean, false) AS include_other,
    CASE WHEN q->>'date_from' ~ '^\d{4}-\d{2}-\d{2}$' THEN (q->>'date_from')::date END AS date_from,
    CASE WHEN q->>'date_to' ~ '^\d{4}-\d{2}-\d{2}$' THEN (q->>'date_to')::date END AS date_to,
    nullif(trim(q->>'search'), '') AS search,
    CASE WHEN q->>'sort' IN (
      'sf2g_total','total_rides','avg_speed_mps','median_speed_mps',
      'sf2g_distance_meters','sf2g_elevation_meters','active_years','last_ride_date',
      'first_ride_date','avg_watts','median_watts','avg_heartrate','avg_kilojoules',
      'bayway_count','skyline_count','hmbw_count','royale_count','fleaway_count',
      'mebw_count','febw_count','other_count','display_name','sf2g_dist_pct','sf2g_elev_pct',
      'total_distance_meters','total_elevation_meters'
    ) THEN q->>'sort' ELSE 'sf2g_total' END AS sort,
    coalesce(lower(q->>'dir'), 'desc') = 'asc' AS asc_order
),
eligible AS (
  SELECT * FROM sf2g_filtered_rides(q - 'user_id')
),
per_rider AS (
  SELECT
    e.user_id,
    count(*) FILTER (WHERE e.route_category <> 'other') AS sf2g_total,
    count(*) AS total_rides,
    count(*) FILTER (WHERE e.route_category = 'bayway') AS bayway_count,
    count(*) FILTER (WHERE e.route_category = 'skyline') AS skyline_count,
    count(*) FILTER (WHERE e.route_category = 'hmbw') AS hmbw_count,
    count(*) FILTER (WHERE e.route_category = 'royale') AS royale_count,
    count(*) FILTER (WHERE e.route_category = 'fleaway') AS fleaway_count,
    count(*) FILTER (WHERE e.route_category = 'mebw') AS mebw_count,
    count(*) FILTER (WHERE e.route_category = 'febw') AS febw_count,
    count(*) FILTER (WHERE e.route_category = 'other') AS other_count,
    coalesce(avg(e.average_speed_mps) FILTER (WHERE e.route_category <> 'other'), 0)::double precision AS avg_speed_mps,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.average_speed_mps)
       FILTER (WHERE e.route_category <> 'other' AND e.average_speed_mps IS NOT NULL))::double precision AS median_speed_mps,
    coalesce(sum(e.distance_meters) FILTER (WHERE e.route_category <> 'other'), 0)::double precision AS sf2g_distance_meters,
    coalesce(sum(e.elevation_gain_meters) FILTER (WHERE e.route_category <> 'other'), 0)::double precision AS sf2g_elevation_meters,
    max(e.ride_date)::text AS last_ride_date,
    min(e.ride_date)::text AS first_ride_date,
    (avg(e.average_watts) FILTER (WHERE e.route_category <> 'other' AND e.average_watts IS NOT NULL))::double precision AS avg_watts,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY e.average_watts)
       FILTER (WHERE e.route_category <> 'other' AND e.average_watts IS NOT NULL))::double precision AS median_watts,
    (avg(e.average_heartrate) FILTER (WHERE e.route_category <> 'other' AND e.average_heartrate IS NOT NULL))::double precision AS avg_heartrate,
    (avg(e.kilojoules) FILTER (WHERE e.route_category <> 'other' AND e.kilojoules IS NOT NULL))::double precision AS avg_kilojoules
  FROM eligible e
  GROUP BY e.user_id
),
all_ride_totals AS (
  SELECT r.user_id,
         coalesce(sum(r.distance_meters), 0)::double precision AS total_distance_meters,
         coalesce(sum(r.elevation_gain_meters), 0)::double precision AS total_elevation_meters
  FROM rides r, params p
  WHERE r.user_id IN (SELECT user_id FROM per_rider)
    AND (p.date_from IS NULL OR r.ride_date >= p.date_from)
    AND (p.date_to IS NULL OR r.ride_date <= p.date_to)
  GROUP BY r.user_id
),
career_years AS (
  SELECT r.user_id, count(DISTINCT extract(year FROM r.ride_date)) AS active_years
  FROM rides r
  WHERE r.user_id IN (SELECT user_id FROM per_rider)
    AND r.route_category IS NOT NULL AND r.route_category <> 'other'
    AND NOT coalesce(r.is_hidden, false) AND NOT coalesce(r.is_private, false)
  GROUP BY r.user_id
),
rows AS (
  SELECT
    pr.user_id, u.display_name, u.avatar_url, u.username,
    pr.sf2g_total, pr.total_rides,
    pr.bayway_count, pr.skyline_count, pr.hmbw_count, pr.royale_count,
    pr.fleaway_count, pr.mebw_count, pr.febw_count, pr.other_count,
    pr.avg_speed_mps, pr.median_speed_mps,
    pr.sf2g_distance_meters, pr.sf2g_elevation_meters,
    coalesce(t.total_distance_meters, pr.sf2g_distance_meters) AS total_distance_meters,
    coalesce(t.total_elevation_meters, pr.sf2g_elevation_meters) AS total_elevation_meters,
    coalesce(cy.active_years, 0) AS active_years,
    pr.last_ride_date, pr.first_ride_date,
    0::double precision AS avg_tailwind_ms,
    pr.avg_watts, pr.median_watts, pr.avg_heartrate, pr.avg_kilojoules
  FROM per_rider pr
  JOIN users u ON u.id = pr.user_id
  LEFT JOIN all_ride_totals t ON t.user_id = pr.user_id
  LEFT JOIN career_years cy ON cy.user_id = pr.user_id
  CROSS JOIN params p
  WHERE (pr.sf2g_total + CASE WHEN p.include_other OR 'other' = ANY (p.routes) THEN pr.other_count ELSE 0 END) > 0
    AND (p.search IS NULL
         OR u.display_name ILIKE '%' || p.search || '%'
         OR u.username ILIKE '%' || p.search || '%')
)
SELECT r.*, count(*) OVER () AS total_count
FROM rows r, params p
ORDER BY
  CASE WHEN NOT p.asc_order THEN
    CASE p.sort
      WHEN 'display_name' THEN NULL
      WHEN 'last_ride_date' THEN NULL
      WHEN 'first_ride_date' THEN NULL
      WHEN 'sf2g_dist_pct' THEN round((r.sf2g_distance_meters / nullif(r.total_distance_meters, 0))::numeric, 6)
      WHEN 'sf2g_elev_pct' THEN round((r.sf2g_elevation_meters / nullif(r.total_elevation_meters, 0))::numeric, 6)
      ELSE round((to_jsonb(r) ->> p.sort)::numeric, 6)
    END
  END DESC NULLS LAST,
  CASE WHEN p.asc_order THEN
    CASE p.sort
      WHEN 'display_name' THEN NULL
      WHEN 'last_ride_date' THEN NULL
      WHEN 'first_ride_date' THEN NULL
      WHEN 'sf2g_dist_pct' THEN round((r.sf2g_distance_meters / nullif(r.total_distance_meters, 0))::numeric, 6)
      WHEN 'sf2g_elev_pct' THEN round((r.sf2g_elevation_meters / nullif(r.total_elevation_meters, 0))::numeric, 6)
      ELSE round((to_jsonb(r) ->> p.sort)::numeric, 6)
    END
  END ASC NULLS LAST,
  CASE WHEN NOT p.asc_order AND p.sort IN ('display_name','last_ride_date','first_ride_date')
       THEN to_jsonb(r) ->> p.sort END DESC NULLS LAST,
  CASE WHEN p.asc_order AND p.sort IN ('display_name','last_ride_date','first_ride_date')
       THEN to_jsonb(r) ->> p.sort END ASC NULLS LAST,
  r.display_name ASC,
  r.user_id ASC
$$;

-- ------------------------------------------------------------
-- 3. get_rides: the Rides view (filter, sort, page — all in SQL)
-- ------------------------------------------------------------
-- Extra q keys: include_other, search (ride name), sort, dir, page, page_size.
-- Fixes D8: weekend/reverse filters used to run in JS after paging, so
-- pages came back short and total_count ignored them.
CREATE OR REPLACE FUNCTION get_rides(q jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  strava_activity_id bigint,
  display_name text,
  avatar_url text,
  username text,
  name text,
  ride_date date,
  route_category text,
  average_speed_mps real,
  distance_meters real,
  elevation_gain_meters real,
  moving_time_seconds integer,
  destination_company text,
  start_latlng jsonb,
  end_latlng jsonb,
  average_watts real,
  max_watts real,
  average_heartrate real,
  max_heartrate real,
  kilojoules real,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH p AS (
  SELECT
    nullif(trim(q->>'search'), '') AS search,
    CASE WHEN q->>'sort' IN (
      'ride_date','average_speed_mps','distance_meters','elevation_gain_meters',
      'moving_time_seconds','name','route_category','display_name',
      'average_watts','max_watts','average_heartrate','max_heartrate','kilojoules'
    ) THEN q->>'sort' ELSE 'ride_date' END AS sort,
    coalesce(lower(q->>'dir'), 'desc') = 'asc' AS asc_order,
    greatest(1, coalesce((q->>'page')::int, 1)) AS page,
    least(500, greatest(1, coalesce((q->>'page_size')::int, 200))) AS page_size,
    sf2g_counts_other(q) AS counts_other
),
rows AS (
  SELECT
    r.id, r.user_id, r.strava_activity_id, u.display_name, u.avatar_url, u.username,
    r.name, r.ride_date, r.route_category, r.average_speed_mps, r.distance_meters,
    r.elevation_gain_meters, r.moving_time_seconds, r.destination_company,
    r.start_latlng, r.end_latlng, r.average_watts, r.max_watts,
    r.average_heartrate, r.max_heartrate, r.kilojoules
  FROM sf2g_filtered_rides(q) r
  JOIN users u ON u.id = r.user_id, p
  WHERE (p.counts_other OR r.route_category <> 'other')
    AND (p.search IS NULL OR r.name ILIKE '%' || replace(replace(replace(p.search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
)
SELECT r.*, count(*) OVER () AS total_count
FROM rows r, p
ORDER BY
  CASE WHEN p.sort IN ('name','route_category','display_name','ride_date') THEN NULL
       WHEN p.asc_order THEN round((to_jsonb(r) ->> p.sort)::numeric, 6) END ASC NULLS LAST,
  CASE WHEN p.sort IN ('name','route_category','display_name','ride_date') THEN NULL
       WHEN NOT p.asc_order THEN round((to_jsonb(r) ->> p.sort)::numeric, 6) END DESC NULLS LAST,
  CASE WHEN p.sort IN ('name','route_category','display_name','ride_date') AND p.asc_order
       THEN to_jsonb(r) ->> p.sort END ASC NULLS LAST,
  CASE WHEN p.sort IN ('name','route_category','display_name','ride_date') AND NOT p.asc_order
       THEN to_jsonb(r) ->> p.sort END DESC NULLS LAST,
  r.id ASC
LIMIT (SELECT page_size FROM p)
OFFSET (SELECT (page - 1) * page_size FROM p)
$$;

-- ------------------------------------------------------------
-- 4. get_alltime_leaderboard: most rides in any N-day window
-- ------------------------------------------------------------
-- Same rule as the old JS sliding window: a window starting on a ride date d
-- covers rides dated d .. d + duration_days (inclusive); the earliest best
-- window wins. Top 200 riders; ride dates only for the top 10.
CREATE OR REPLACE FUNCTION get_alltime_leaderboard(q jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH p AS (
  SELECT
    least(3650, greatest(1, round(coalesce((q->>'duration_days')::numeric, 30))))::int AS days,
    sf2g_counts_other(q) AS counts_other
),
e AS (
  SELECT r.user_id, r.ride_date, r.id
  FROM sf2g_filtered_rides(q) r, p
  WHERE p.counts_other OR r.route_category <> 'other'
),
windows AS (
  SELECT
    e.user_id,
    e.ride_date AS start_date,
    count(*) OVER (
      PARTITION BY e.user_id ORDER BY e.ride_date
      RANGE BETWEEN CURRENT ROW AND (SELECT days FROM p) * interval '1 day' FOLLOWING
    ) AS n
  FROM e
),
best AS (
  SELECT DISTINCT ON (w.user_id) w.user_id, w.start_date, w.n
  FROM windows w
  ORDER BY w.user_id, w.n DESC, w.start_date ASC
),
totals AS (
  SELECT e.user_id, count(*) AS total FROM e GROUP BY e.user_id
),
ranked AS (
  SELECT
    b.user_id, b.start_date, b.n, t.total,
    u.display_name, u.avatar_url,
    row_number() OVER (ORDER BY b.n DESC, t.total DESC, u.display_name ASC, b.user_id ASC) AS rank
  FROM best b
  JOIN totals t ON t.user_id = b.user_id
  JOIN users u ON u.id = b.user_id
)
SELECT coalesce(jsonb_agg(
  jsonb_build_object(
    'userId', r.user_id,
    'displayName', coalesce(nullif(r.display_name, ''), 'Unknown'),
    'avatarUrl', nullif(r.avatar_url, ''),
    'maxRidesInWindow', r.n,
    'windowStart', r.start_date::text,
    'windowEnd', (
      SELECT max(e.ride_date)::text FROM e
      WHERE e.user_id = r.user_id
        AND e.ride_date BETWEEN r.start_date AND r.start_date + (SELECT days FROM p)
    ),
    'totalSf2gRides', r.total,
    'rideDatesInWindow', CASE WHEN r.rank <= 10 THEN coalesce((
      SELECT jsonb_agg(e.ride_date::text ORDER BY e.ride_date, e.id) FROM e
      WHERE e.user_id = r.user_id
        AND e.ride_date BETWEEN r.start_date AND r.start_date + (SELECT days FROM p)
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  ) ORDER BY r.rank
), '[]'::jsonb)
FROM ranked r
WHERE r.rank <= 200
$$;

-- ------------------------------------------------------------
-- 5. get_rider_growth: chart buckets for the riders on the chart
-- ------------------------------------------------------------
-- granularity: 'daily' | 'weekly' (Monday buckets) | 'monthly' (1st of month)
-- Returns [{ "user_id", "bucket": "YYYY-MM-DD", "count" }] for rider_ids only,
-- using the same filters as the table next to it.
CREATE OR REPLACE FUNCTION get_rider_growth(q jsonb, rider_ids uuid[], granularity text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH p AS (SELECT sf2g_counts_other(q) AS counts_other),
e AS (
  SELECT r.user_id,
         CASE granularity
           WHEN 'daily' THEN r.ride_date
           WHEN 'weekly' THEN (r.ride_date - (extract(isodow FROM r.ride_date)::int - 1))
           ELSE date_trunc('month', r.ride_date)::date
         END AS bucket
  FROM sf2g_filtered_rides(q) r, p
  WHERE r.user_id = ANY (rider_ids)
    AND (p.counts_other OR r.route_category <> 'other')
)
SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'bucket', bucket::text, 'count', n)
                          ORDER BY bucket, user_id), '[]'::jsonb)
FROM (SELECT user_id, bucket, count(*) AS n FROM e GROUP BY user_id, bucket) b
$$;

-- ------------------------------------------------------------
-- 6. Community stats (profile page comparisons)
-- ------------------------------------------------------------
-- SF2G vs Other distance/elevation over every visible classified ride.
CREATE OR REPLACE FUNCTION get_community_breakdown()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH r AS (
  SELECT route_category, coalesce(distance_meters, 0) AS d, coalesce(elevation_gain_meters, 0) AS el
  FROM rides
  WHERE route_category IS NOT NULL
    AND NOT coalesce(is_hidden, false) AND NOT coalesce(is_private, false)
),
s AS (
  SELECT
    coalesce(sum(d) FILTER (WHERE route_category <> 'other'), 0)::double precision AS sd,
    coalesce(sum(el) FILTER (WHERE route_category <> 'other'), 0)::double precision AS se,
    count(*) FILTER (WHERE route_category <> 'other') AS sc,
    coalesce(sum(d) FILTER (WHERE route_category = 'other'), 0)::double precision AS od,
    coalesce(sum(el) FILTER (WHERE route_category = 'other'), 0)::double precision AS oe,
    count(*) FILTER (WHERE route_category = 'other') AS oc
  FROM r
)
SELECT jsonb_build_object(
  'sf2g_distance_meters', sd, 'other_distance_meters', od, 'total_distance_meters', sd + od,
  'sf2g_elevation_meters', se, 'other_elevation_meters', oe, 'total_elevation_meters', se + oe,
  'sf2g_ride_count', sc, 'other_ride_count', oc, 'total_ride_count', sc + oc
) FROM s
$$;

-- Average start hour per rider. Kept in UTC to match the profile's own
-- comparison (ProfileFunStats); both move to local time in the phase 06
-- date audit.
CREATE OR REPLACE FUNCTION get_community_start_hours()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
SELECT jsonb_build_object('averageHours', coalesce(jsonb_agg(h ORDER BY h), '[]'::jsonb))
FROM (
  SELECT avg(extract(hour FROM start_date AT TIME ZONE 'UTC')
             + extract(minute FROM start_date AT TIME ZONE 'UTC') / 60.0)::double precision AS h
  FROM rides
  WHERE route_category IS NOT NULL
    AND NOT coalesce(is_hidden, false) AND NOT coalesce(is_private, false)
  GROUP BY user_id
) x
$$;

-- Week key used by the profile's streak logic (computeBestWeekStreak /
-- ProfileFunStats): Sunday-based week number within the calendar year.
CREATE OR REPLACE FUNCTION sf2g_week_key(d date)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT extract(year FROM d)::int || '-' || lpad(ceil(
    ((d - make_date(extract(year FROM d)::int, 1, 1))
      + extract(dow FROM make_date(extract(year FROM d)::int, 1, 1))::int + 1) / 7.0
  )::int::text, 2, '0')
$$;

-- Best streak of consecutive weeks with a ride, per rider: walks Monday-aligned
-- weeks from the first to the last ride and checks each week's key, exactly
-- like computeBestWeekStreak().
CREATE OR REPLACE FUNCTION get_community_streaks()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH d AS (
  SELECT user_id, ride_date FROM rides
  WHERE route_category IS NOT NULL
    AND NOT coalesce(is_hidden, false) AND NOT coalesce(is_private, false)
),
keys AS (SELECT DISTINCT user_id, sf2g_week_key(ride_date) AS k FROM d),
bounds AS (SELECT user_id, min(ride_date) AS f, max(ride_date) AS l FROM d GROUP BY user_id),
cursor AS (
  SELECT b.user_id, c::date AS c,
         EXISTS (SELECT 1 FROM keys k WHERE k.user_id = b.user_id AND k.k = sf2g_week_key(c::date)) AS present
  FROM bounds b,
       generate_series(b.f - (extract(isodow FROM b.f)::int - 1), b.l, interval '7 days') c
),
grouped AS (
  SELECT user_id, present,
         count(*) FILTER (WHERE NOT present) OVER (PARTITION BY user_id ORDER BY c) AS grp
  FROM cursor
),
best AS (
  SELECT user_id, coalesce(max(n), 0) AS best
  FROM (SELECT user_id, grp, count(*) FILTER (WHERE present) AS n FROM grouped GROUP BY user_id, grp) g
  GROUP BY user_id
)
SELECT jsonb_build_object('bestStreaks', coalesce(jsonb_agg(best ORDER BY best), '[]'::jsonb))
FROM best
$$;

GRANT EXECUTE ON FUNCTION
  sf2g_filtered_rides(jsonb), sf2g_counts_other(jsonb), get_leaderboard(jsonb),
  get_rides(jsonb), get_alltime_leaderboard(jsonb), get_rider_growth(jsonb, uuid[], text),
  get_community_breakdown(), get_community_start_hours(), sf2g_week_key(date),
  get_community_streaks()
TO anon, authenticated, service_role;
