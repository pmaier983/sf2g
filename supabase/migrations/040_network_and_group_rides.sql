-- One-time backfills below can exceed the API roles' 8 s statement timeout.
SET statement_timeout = 0;

-- ============================================================
-- Migration 040: rider network + group rides computed in SQL
-- (rework phase 03d)
-- ============================================================
-- /network used to page every co-ride pair (with both polylines) into the
-- Worker and decode + compare polylines on every page view (5-12 s, and a
-- CPU-bound 1102 risk). Group rides were clustered in JS after paging the
-- same view. Now:
--   * ride_pair_overlap caches the polyline overlap of each co-ride pair,
--     computed once when ride_co_occurrences is refreshed;
--   * get_rider_network() returns pre-aggregated nodes and edges;
--   * recompute_group_rides() clusters and stores group rides in one call.
-- Hidden and private rides are excluded, like everywhere else.

-- ------------------------------------------------------------
-- 1. Polyline overlap (port of computePolylineOverlap)
-- ------------------------------------------------------------
-- Share of ~25 sampled points of the shorter ride that lie within 200 m of
-- one of ~50 sampled points of the other ride.
CREATE OR REPLACE FUNCTION sf2g_polyline_overlap(p1 text, p2 text)
RETURNS real
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  la1 double precision[]; ln1 double precision[];
  la2 double precision[]; ln2 double precision[];
  n1 int; n2 int;
  s_la double precision[]; s_ln double precision[];   -- shorter, sampled /25
  l_la double precision[]; l_ln double precision[];   -- longer, sampled /50
  rate int; i int; j int;
  hits int := 0; found boolean;
  d_lat double precision; d_lng double precision; a double precision;
BEGIN
  IF p1 IS NULL OR p2 IS NULL OR p1 = '' OR p2 = '' THEN RETURN 0; END IF;
  IF p1 = p2 THEN RETURN 1; END IF;

  SELECT array_agg(lat ORDER BY idx), array_agg(lng ORDER BY idx) INTO la1, ln1 FROM sf2g_decode_polyline(p1);
  SELECT array_agg(lat ORDER BY idx), array_agg(lng ORDER BY idx) INTO la2, ln2 FROM sf2g_decode_polyline(p2);
  n1 := coalesce(array_length(la1, 1), 0);
  n2 := coalesce(array_length(la2, 1), 0);
  IF n1 = 0 OR n2 = 0 THEN RETURN 0; END IF;

  -- bounding-box rejection
  IF (SELECT min(x) FROM unnest(la1) x) - 0.003 > (SELECT max(x) FROM unnest(la2) x)
     OR (SELECT max(x) FROM unnest(la1) x) + 0.003 < (SELECT min(x) FROM unnest(la2) x)
     OR (SELECT min(x) FROM unnest(ln1) x) - 0.004 > (SELECT max(x) FROM unnest(ln2) x)
     OR (SELECT max(x) FROM unnest(ln1) x) + 0.004 < (SELECT min(x) FROM unnest(ln2) x) THEN
    RETURN 0;
  END IF;

  -- sampled = every floor(n/25)th point of each polyline; the ride with
  -- fewer sampled points is checked against the other's /50 sample.
  DECLARE
    s1_la double precision[] := '{}'; s1_ln double precision[] := '{}';
    s2_la double precision[] := '{}'; s2_ln double precision[] := '{}';
    g1_la double precision[] := '{}'; g1_ln double precision[] := '{}';
    g2_la double precision[] := '{}'; g2_ln double precision[] := '{}';
  BEGIN
    rate := greatest(1, n1 / 25);
    FOR i IN 0..n1 - 1 LOOP IF i % rate = 0 THEN s1_la := s1_la || la1[i + 1]; s1_ln := s1_ln || ln1[i + 1]; END IF; END LOOP;
    rate := greatest(1, n1 / 50);
    FOR i IN 0..n1 - 1 LOOP IF i % rate = 0 THEN g1_la := g1_la || la1[i + 1]; g1_ln := g1_ln || ln1[i + 1]; END IF; END LOOP;
    rate := greatest(1, n2 / 25);
    FOR i IN 0..n2 - 1 LOOP IF i % rate = 0 THEN s2_la := s2_la || la2[i + 1]; s2_ln := s2_ln || ln2[i + 1]; END IF; END LOOP;
    rate := greatest(1, n2 / 50);
    FOR i IN 0..n2 - 1 LOOP IF i % rate = 0 THEN g2_la := g2_la || la2[i + 1]; g2_ln := g2_ln || ln2[i + 1]; END IF; END LOOP;

    IF array_length(s1_la, 1) <= array_length(s2_la, 1) THEN
      s_la := s1_la; s_ln := s1_ln; l_la := g2_la; l_ln := g2_ln;
    ELSE
      s_la := s2_la; s_ln := s2_ln; l_la := g1_la; l_ln := g1_ln;
    END IF;
  END;

  FOR i IN 1..array_length(s_la, 1) LOOP
    found := false;
    FOR j IN 1..array_length(l_la, 1) LOOP
      d_lat := s_la[i] - l_la[j];
      d_lng := (s_ln[i] - l_ln[j]) * 0.793;
      CONTINUE WHEN d_lat * d_lat + d_lng * d_lng > 0.0000035;
      a := sin(radians(l_la[j] - s_la[i]) / 2) ^ 2
           + cos(radians(s_la[i])) * cos(radians(l_la[j])) * sin(radians(l_ln[j] - s_ln[i]) / 2) ^ 2;
      IF 6371000 * 2 * atan2(sqrt(a), sqrt(1 - a)) <= 200 THEN
        found := true;
        EXIT;
      END IF;
    END LOOP;
    IF found THEN hits := hits + 1; END IF;
  END LOOP;

  RETURN hits::real / array_length(s_la, 1);
END;
$$;

-- ------------------------------------------------------------
-- 2. Cached overlap per co-ride pair, maintained with the MV refresh
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride_pair_overlap (
  ride1_id uuid NOT NULL,
  ride2_id uuid NOT NULL,
  overlap real NOT NULL,
  PRIMARY KEY (ride1_id, ride2_id)
);
ALTER TABLE ride_pair_overlap ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ride_pair_overlap" ON ride_pair_overlap FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION refresh_ride_co_occurrences()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW ride_co_occurrences;

  DELETE FROM ride_pair_overlap o
  WHERE NOT EXISTS (
    SELECT 1 FROM ride_co_occurrences c
    WHERE c.ride1_id = o.ride1_id AND c.ride2_id = o.ride2_id
  );

  -- Only pairs not computed before: the expensive part runs once per pair.
  INSERT INTO ride_pair_overlap (ride1_id, ride2_id, overlap)
  SELECT c.ride1_id, c.ride2_id,
         CASE WHEN c.polyline1 IS NULL OR c.polyline2 IS NULL THEN 1
              ELSE sf2g_polyline_overlap(c.polyline1, c.polyline2) END
  FROM ride_co_occurrences c
  WHERE NOT EXISTS (
    SELECT 1 FROM ride_pair_overlap o
    WHERE o.ride1_id = c.ride1_id AND o.ride2_id = c.ride2_id
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION refresh_ride_co_occurrences() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_ride_co_occurrences() TO service_role;

-- Visible co-ride pairs with their overlap.
CREATE OR REPLACE VIEW visible_ride_pairs
WITH (security_invoker = true) AS
SELECT c.ride1_id, c.rider1_id, c.ride2_id, c.rider2_id, c.route_category, c.ride_date,
       coalesce(o.overlap, 1) AS overlap
FROM ride_co_occurrences c
JOIN rides r1 ON r1.id = c.ride1_id
JOIN rides r2 ON r2.id = c.ride2_id
LEFT JOIN ride_pair_overlap o ON o.ride1_id = c.ride1_id AND o.ride2_id = c.ride2_id
WHERE NOT coalesce(r1.is_hidden, false) AND NOT coalesce(r1.is_private, false)
  AND NOT coalesce(r2.is_hidden, false) AND NOT coalesce(r2.is_private, false);

-- ------------------------------------------------------------
-- 3. Rider network
-- ------------------------------------------------------------
-- Nodes: riders with at least one visible SF2G ride. Edges: rider pairs with
-- at least 3 co-rides whose GPS tracks overlap >= 30% (as before).
CREATE OR REPLACE FUNCTION get_rider_network()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH counts AS (
  SELECT r.user_id, r.route_category, count(*) AS n
  FROM rides r
  WHERE r.route_category IS NOT NULL AND r.route_category <> 'other'
    AND NOT coalesce(r.is_hidden, false) AND NOT coalesce(r.is_private, false)
  GROUP BY r.user_id, r.route_category
),
riders AS (
  SELECT c.user_id, sum(c.n) AS total,
         (array_agg(c.route_category ORDER BY c.n DESC,
            array_position(ARRAY['bayway','skyline','hmbw','royale','fleaway','mebw','febw'], c.route_category)))[1] AS primary_route
  FROM counts c GROUP BY c.user_id
),
pair_routes AS (
  SELECT p.rider1_id, p.rider2_id, p.route_category, count(*) AS n
  FROM visible_ride_pairs p
  WHERE p.overlap >= 0.3
    AND p.rider1_id IN (SELECT user_id FROM riders)
    AND p.rider2_id IN (SELECT user_id FROM riders)
  GROUP BY p.rider1_id, p.rider2_id, p.route_category
),
edges AS (
  SELECT rider1_id, rider2_id, sum(n) AS weight, jsonb_object_agg(route_category, n) AS routes
  FROM pair_routes GROUP BY rider1_id, rider2_id
  HAVING sum(n) >= 3
)
SELECT jsonb_build_object(
  'riders', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.user_id,
      'name', coalesce(u.display_name, 'Anonymous'),
      'avatar', u.avatar_url,
      'totalRides', r.total,
      'primaryRoute', r.primary_route
    ) ORDER BY r.total DESC, u.display_name, r.user_id)
    FROM riders r JOIN users u ON u.id = r.user_id
  ), '[]'::jsonb),
  'edges', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'source', e.rider1_id, 'target', e.rider2_id, 'weight', e.weight, 'routes', e.routes
    ) ORDER BY e.weight DESC, e.rider1_id, e.rider2_id)
    FROM edges e
  ), '[]'::jsonb)
)
$$;

-- ------------------------------------------------------------
-- 4. Group rides
-- ------------------------------------------------------------
-- Connected components of riders per (date, route) over co-ride pairs, same
-- as clusterIntoGroups(). Ids are SHA-256("date:route:sorted rider ids")
-- truncated to 16 hex chars — identical to the old TS ids, so existing
-- /group-rides/<id> links keep working.
CREATE OR REPLACE FUNCTION recompute_group_rides()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
  groups integer;
BEGIN
  CREATE TEMP TABLE _edges ON COMMIT DROP AS
    SELECT ride_date, route_category, rider1_id AS a, rider2_id AS b, ride1_id AS ra, ride2_id AS rb
    FROM visible_ride_pairs;

  CREATE TEMP TABLE _label ON COMMIT DROP AS
    SELECT DISTINCT ride_date, route_category, x AS rider, x AS label
    FROM _edges, LATERAL (VALUES (a), (b)) v(x);

  -- Propagate the smallest rider id through each component.
  LOOP
    UPDATE _label l SET label = m.label
    FROM (
      SELECT e.ride_date, e.route_category, e.a AS rider, min(lb.label::text)::uuid AS label
      FROM _edges e JOIN _label lb
        ON lb.ride_date = e.ride_date AND lb.route_category = e.route_category AND lb.rider = e.b
      GROUP BY 1, 2, 3
      UNION ALL
      SELECT e.ride_date, e.route_category, e.b, min(la.label::text)::uuid
      FROM _edges e JOIN _label la
        ON la.ride_date = e.ride_date AND la.route_category = e.route_category AND la.rider = e.a
      GROUP BY 1, 2, 3
    ) m
    WHERE l.ride_date = m.ride_date AND l.route_category = m.route_category
      AND l.rider = m.rider AND m.label::text < l.label::text;
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
  END LOOP;

  CREATE TEMP TABLE _groups ON COMMIT DROP AS
  SELECT
    left(encode(sha256(convert_to(
      g.ride_date::text || ':' || g.route_category || ':' ||
      string_agg(g.rider::text, ',' ORDER BY g.rider::text COLLATE "C"), 'UTF8')), 'hex'), 16) AS id,
    g.ride_date, g.route_category, g.label,
    array_agg(g.rider) AS riders
  FROM _label g
  GROUP BY g.ride_date, g.route_category, g.label
  HAVING count(*) >= 2;

  -- Rides of each group's members that appear in its pairs
  CREATE TEMP TABLE _group_rides ON COMMIT DROP AS
  SELECT DISTINCT gr.id, x.ride_id
  FROM _groups gr
  JOIN _edges e ON e.ride_date = gr.ride_date AND e.route_category = gr.route_category
  CROSS JOIN LATERAL (VALUES (e.a, e.ra), (e.b, e.rb)) x(rider, ride_id)
  WHERE x.rider = ANY (gr.riders);

  DELETE FROM group_rides WHERE true;

  INSERT INTO group_rides (id, ride_date, route_category, rider_count, avg_speed_mps, max_speed_mps,
                           avg_watts, max_watts, avg_heartrate, total_distance_meters,
                           total_elevation_meters, computed_at)
  SELECT gr.id, gr.ride_date, gr.route_category, cardinality(gr.riders),
         coalesce(avg(r.average_speed_mps), 0), coalesce(max(r.max_speed_mps), 0),
         avg(r.average_watts), max(r.max_watts), avg(r.average_heartrate),
         coalesce(sum(r.distance_meters), 0), coalesce(sum(r.elevation_gain_meters), 0),
         now()
  FROM _groups gr
  JOIN _group_rides x ON x.id = gr.id
  JOIN rides r ON r.id = x.ride_id
  GROUP BY gr.id, gr.ride_date, gr.route_category, gr.riders;

  INSERT INTO group_ride_members (group_ride_id, user_id, display_name, avatar_url)
  SELECT gr.id, m.rider, u.display_name, u.avatar_url
  FROM _groups gr
  CROSS JOIN LATERAL unnest(gr.riders) m(rider)
  JOIN users u ON u.id = m.rider;

  SELECT count(*) INTO groups FROM _groups;
  RETURN groups;
END;
$$;
REVOKE EXECUTE ON FUNCTION recompute_group_rides() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_group_rides() TO service_role;

GRANT EXECUTE ON FUNCTION get_rider_network(), sf2g_polyline_overlap(text, text)
  TO anon, authenticated, service_role;
GRANT SELECT ON visible_ride_pairs, ride_pair_overlap TO anon, authenticated, service_role;

-- Fill the overlap cache once.
SELECT refresh_ride_co_occurrences();
