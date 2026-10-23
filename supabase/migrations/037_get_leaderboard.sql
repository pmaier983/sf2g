-- ============================================================
-- Migration 037: one SQL function for the Riders leaderboard
-- ============================================================
-- Replaces three divergent code paths (leaderboard_view, the
-- get_leaderboard_by_date_range RPC, and a JS aggregation that paged every
-- ride into the Worker) with get_leaderboard(q jsonb). Every filter is applied
-- once, to one set of eligible rides, in the database.
--
-- To make every filter expressible in SQL, two per-ride facts that used to be
-- computed in TypeScript on every request are now stored on `rides`:
--   commute_direction  'sf2g' | 'g2sf' | NULL   (generated column)
--   is_ppr_dawn        boolean                 (trigger-maintained)
-- The functions below are ports of app/lib/route-classifier.ts
-- (getCommuteDirection) and app/server/leaderboard.ts (PPR intercept timing);
-- app/server/__test__/db/sql-ports.test.ts checks they agree with the TS.

-- ------------------------------------------------------------
-- 1. Commute direction
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sf2g_point_in_sf(lat double precision, lng double precision)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  -- SF_BOUNDS in app/lib/constants.ts
  SELECT lat BETWEEN 37.7 AND 37.82 AND lng BETWEEN -122.52 AND -122.34
$$;

CREATE OR REPLACE FUNCTION sf2g_point_in_corridor(lat double precision, lng double precision)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  -- PENINSULA_CORRIDOR in app/lib/constants.ts, as [lat, lng] pairs
  ys double precision[] := ARRAY[37.69, 37.63, 37.57, 37.5, 37.44, 37.39, 37.35, 37.25,
                                 37.25, 37.3, 37.35, 37.39, 37.42, 37.48, 37.57, 37.63, 37.69];
  xs double precision[] := ARRAY[-122.54, -122.5, -122.44, -122.38, -122.27, -122.15, -122.1, -122.01,
                                 -121.85, -121.9, -121.93, -121.99, -122.02, -122.15, -122.25, -122.31, -122.34];
  n int := array_length(ys, 1);
  inside boolean := false;
  i int;
  j int := n;
BEGIN
  IF lat IS NULL OR lng IS NULL THEN
    RETURN false;
  END IF;
  -- Ray casting, identical to isPointInPolygon()
  FOR i IN 1..n LOOP
    IF (ys[i] > lat) <> (ys[j] > lat)
       AND lng < (xs[j] - xs[i]) * (lat - ys[i]) / (ys[j] - ys[i]) + xs[i] THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END;
$$;

CREATE OR REPLACE FUNCTION sf2g_commute_direction(start_latlng jsonb, end_latlng jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  slat double precision;
  slng double precision;
  elat double precision;
  elng double precision;
BEGIN
  IF jsonb_typeof(start_latlng) <> 'array' OR jsonb_typeof(end_latlng) <> 'array'
     OR jsonb_array_length(start_latlng) < 2 OR jsonb_array_length(end_latlng) < 2 THEN
    RETURN NULL;
  END IF;
  slat := (start_latlng->>0)::double precision;
  slng := (start_latlng->>1)::double precision;
  elat := (end_latlng->>0)::double precision;
  elng := (end_latlng->>1)::double precision;

  IF sf2g_point_in_sf(slat, slng) AND sf2g_point_in_corridor(elat, elng) THEN
    RETURN 'sf2g';
  ELSIF sf2g_point_in_corridor(slat, slng) AND sf2g_point_in_sf(elat, elng) THEN
    RETURN 'g2sf';
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS commute_direction text
  GENERATED ALWAYS AS (sf2g_commute_direction(start_latlng, end_latlng)) STORED;

-- ------------------------------------------------------------
-- 2. PPR @ dawn
-- ------------------------------------------------------------
-- Google encoded polyline → ordered points (precision 5), like @mapbox/polyline.
CREATE OR REPLACE FUNCTION sf2g_decode_polyline(encoded text)
RETURNS TABLE (idx int, lat double precision, lng double precision)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  len int := coalesce(length(encoded), 0);
  pos int := 1;
  b int;
  shift int;
  result bigint;
  ilat bigint := 0;
  ilng bigint := 0;
  k int := 0;
  part int;
BEGIN
  WHILE pos <= len LOOP
    FOR part IN 1..2 LOOP
      shift := 0;
      result := 0;
      LOOP
        EXIT WHEN pos > len;
        b := ascii(substr(encoded, pos, 1)) - 63;
        pos := pos + 1;
        result := result | ((b & 31)::bigint << shift);
        shift := shift + 5;
        EXIT WHEN b < 32;
      END LOOP;
      IF (result & 1) = 1 THEN
        result := ~(result >> 1);
      ELSE
        result := result >> 1;
      END IF;
      IF part = 1 THEN
        ilat := ilat + result;
      ELSE
        ilng := ilng + result;
      END IF;
    END LOOP;
    idx := k;
    lat := ilat / 1e5;
    lng := ilng / 1e5;
    k := k + 1;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Same rules as fetchPprDawnRiderIds before this migration:
--   * ride starts 04:00–07:59 local time (the old ppr_dawn_rides window);
--   * for each PPR intercept in order, the first decoded point within 500 m
--     gives an estimated arrival = start + (i / (n - 1)) * moving_time;
--   * qualifies if that local HH:MM is within ±10 min of the intercept target.
CREATE OR REPLACE FUNCTION sf2g_is_ppr_dawn(
  polyline text,
  start_date timestamptz,
  tz text,
  moving_time_seconds int
)
RETURNS boolean
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  zone text := extract_iana_timezone(tz);
  local_hour int;
  lats double precision[];
  lngs double precision[];
  n int;
  hit int;
  i int;
  d double precision;
  a double precision;
  arrival timestamptz;
  local_minutes int;
  -- PPR_INTERCEPTS in app/lib/constants.ts
  i_lat double precision[] := ARRAY[37.773433, 37.770192, 37.698411];
  i_lng double precision[] := ARRAY[-122.438898, -122.494076, -122.495033];
  i_target int[] := ARRAY[360, 370, 390];
  k int;
BEGIN
  IF polyline IS NULL OR polyline = '' OR start_date IS NULL THEN
    RETURN false;
  END IF;

  local_hour := EXTRACT(HOUR FROM start_date AT TIME ZONE zone);
  IF local_hour < 4 OR local_hour > 7 THEN
    RETURN false;
  END IF;

  SELECT array_agg(p.lat ORDER BY p.idx), array_agg(p.lng ORDER BY p.idx)
  INTO lats, lngs
  FROM sf2g_decode_polyline(polyline) p;
  n := coalesce(array_length(lats, 1), 0);
  IF n = 0 THEN
    RETURN false;
  END IF;

  FOR k IN 1..array_length(i_lat, 1) LOOP
    hit := NULL;
    FOR i IN 1..n LOOP
      -- ~500 m Euclidean pre-filter, then haversine (same as the TS)
      CONTINUE WHEN (lats[i] - i_lat[k]) ^ 2 + (lngs[i] - i_lng[k]) ^ 2 > 2.5e-5;
      a := sin(radians(i_lat[k] - lats[i]) / 2) ^ 2
           + cos(radians(lats[i])) * cos(radians(i_lat[k])) * sin(radians(i_lng[k] - lngs[i]) / 2) ^ 2;
      d := 6371000 * 2 * atan2(sqrt(a), sqrt(1 - a));
      IF d <= 500 THEN
        hit := i - 1; -- 0-based like the TS
        EXIT;
      END IF;
    END LOOP;

    CONTINUE WHEN hit IS NULL;

    arrival := start_date
      + (CASE WHEN n > 1 THEN hit::double precision / (n - 1) ELSE 0 END)
        * coalesce(moving_time_seconds, 0) * interval '1 second';
    local_minutes := EXTRACT(HOUR FROM arrival AT TIME ZONE zone) * 60
                   + EXTRACT(MINUTE FROM arrival AT TIME ZONE zone);
    IF local_minutes BETWEEN i_target[k] - 10 AND i_target[k] + 10 THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_ppr_dawn boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION rides_set_is_ppr_dawn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.is_ppr_dawn := sf2g_is_ppr_dawn(
    NEW.summary_polyline, NEW.start_date, NEW.timezone, NEW.moving_time_seconds
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_is_ppr_dawn ON rides;
CREATE TRIGGER rides_is_ppr_dawn
  BEFORE INSERT OR UPDATE OF summary_polyline, start_date, timezone, moving_time_seconds
  ON rides
  FOR EACH ROW EXECUTE FUNCTION rides_set_is_ppr_dawn();

-- Backfill (only rides in the dawn window need decoding)
UPDATE rides
SET is_ppr_dawn = sf2g_is_ppr_dawn(summary_polyline, start_date, timezone, moving_time_seconds)
WHERE summary_polyline IS NOT NULL
  AND EXTRACT(HOUR FROM start_date AT TIME ZONE extract_iana_timezone(timezone)) BETWEEN 4 AND 7;

-- ------------------------------------------------------------
-- 3. Indexes for the leaderboard query
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rides_user_date ON rides (user_id, ride_date);
CREATE INDEX IF NOT EXISTS idx_rides_classified_date ON rides (ride_date)
  WHERE route_category IS NOT NULL;

-- ------------------------------------------------------------
-- 4. get_leaderboard(q jsonb)
-- ------------------------------------------------------------
-- q (all optional):
--   routes            text[]   route categories; empty = all
--   include_other     boolean  keep riders whose only matches are "other"
--   date_from/date_to date
--   exclude_weekends  boolean  default true
--   ppr               boolean  only PPR-at-dawn rides
--   reverse           boolean  only Peninsula → SF commutes
--   company           text     destination company
--   search            text     display name / username substring
--   sort / dir        text     column from the allow-list / 'asc'|'desc'
--
-- Eligible rides: classified (route_category NOT NULL, incl. 'other'),
-- not hidden, not private, matching every filter. Every per-rider number is
-- computed from that one set — including under PPR, where the old UI only
-- swapped the count column.
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
    coalesce((q->>'exclude_weekends')::boolean, true) AS exclude_weekends,
    coalesce((q->>'ppr')::boolean, false) AS ppr,
    coalesce((q->>'reverse')::boolean, false) AS reverse,
    nullif(q->>'company', '') AS company,
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
  SELECT r.*
  FROM rides r, params p
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
-- Denominator for "% of distance / elevation that is SF2G": every ride the
-- rider logged in the date range (any category, weekends included).
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
-- Career years badge: unaffected by filters.
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
-- Numeric sort keys are rounded: sums of float columns (and ratios of them)
-- differ in the last bits between runs, which would make ties flip order.
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

GRANT EXECUTE ON FUNCTION get_leaderboard(jsonb) TO anon, authenticated, service_role;
