-- ============================================================
-- Migration 051: store segment PRs only, mark the core of each route,
-- curate which segments the boards use, and run the backfill by itself
-- (rework phase 09a — docs/rework/phase-09-cumulative-segments.md)
-- ============================================================
-- Deploy order: apply this migration BEFORE deploying the Worker that
-- contains 09a. The 09a Worker calls ingest_ride_segment_efforts and
-- plan_segment_jobs, which this migration adds. The old Worker keeps working
-- against it: segment_efforts and users.segment_board_opt_in stay in place
-- (read by nothing new) until 09e drops them.
--
-- After deploying: DevTools → Segments → "Reclassify segment corridors"
-- (fills along_start_m / along_end_m / in_core), then "Curate segments".
--
-- 1. segments: along-track position, in_core, selectable, duplicate_of,
--    sf2g_rides (ride share numerator)
-- 2. users.segment_board_hidden: everyone is on the board unless they hide
--    (Phillip, 2026-11-18: riders consent when they sign up)
-- 3. segment_bests: one row per (segment, rider, year) — that year's fastest
--    effort, plus how many efforts it was chosen from. Every effort is no
--    longer stored.
-- 4. Carry-over from segment_efforts
-- 5. ingest_ride_segment_efforts: the whole ingest of one ride, atomically
-- 6. Invalidation when a ride holding a best is deleted, made private or hidden
-- 7. Rides of every segment route category are fetched; plan_segment_jobs
--    tops up the backfill each tick
-- 8. get_segment_leaderboard reads segment_bests (output unchanged)
-- 9. Admin helpers: corridor/curation batch updates, ride share, stats

-- ------------------------------------------------------------
-- 1. segments
-- ------------------------------------------------------------
ALTER TABLE segments
  ADD COLUMN along_start_m real,
  ADD COLUMN along_end_m   real,
  ADD COLUMN in_core       boolean NOT NULL DEFAULT false,
  ADD COLUMN selectable    boolean NOT NULL DEFAULT false,
  ADD COLUMN duplicate_of  bigint REFERENCES segments(id) ON DELETE SET NULL,
  ADD COLUMN sf2g_rides    int NOT NULL DEFAULT 0;
CREATE INDEX idx_segments_selectable ON segments (corridor, direction) WHERE selectable;

-- ------------------------------------------------------------
-- 2. users.segment_board_hidden (public, non-secret: same column grant as
--    the rest of PUBLIC_USER_COLUMNS in app/lib/public-user.ts)
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN segment_board_hidden boolean NOT NULL DEFAULT false;
GRANT SELECT (segment_board_hidden) ON public.users TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. segment_bests
-- ------------------------------------------------------------
CREATE TABLE segment_bests (
  segment_id           bigint   NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  user_id              uuid     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year                 smallint NOT NULL,              -- of rides.ride_date
  effort_id            bigint   NOT NULL,              -- Strava effort id of the best
  ride_id              uuid     NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  ride_date            date     NOT NULL,
  elapsed_time_seconds int      NOT NULL,
  average_watts        real,
  kom_rank             smallint,                       -- best Strava top-10 rank seen this year
  effort_count         int      NOT NULL,              -- efforts this year (laps count)
  first_ride_date      date     NOT NULL,              -- first effort this year
  PRIMARY KEY (segment_id, user_id, year)
);
CREATE INDEX idx_segment_bests_user ON segment_bests (user_id, year);
CREATE INDEX idx_segment_bests_ride ON segment_bests (ride_id);

ALTER TABLE segment_bests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON segment_bests FROM anon, authenticated;
GRANT ALL ON segment_bests TO service_role;

-- ------------------------------------------------------------
-- 4. Carry-over: rebuild bests from the stored efforts. A function so the
--    db tests can check it against the fixture; run once here.
-- ------------------------------------------------------------
CREATE FUNCTION rebuild_segment_bests_from_efforts()
RETURNS int
LANGUAGE sql
SET search_path = public
AS $$
  WITH eff AS (
    SELECT e.id, e.segment_id, e.user_id, e.ride_id, e.elapsed_time_seconds,
           e.average_watts, e.kom_rank, r.ride_date,
           extract(year FROM r.ride_date)::smallint AS year
    FROM segment_efforts e
    JOIN rides r ON r.id = e.ride_id
    WHERE r.is_private IS NOT TRUE AND r.is_hidden IS NOT TRUE
  ),
  stats AS (
    SELECT segment_id, user_id, year, count(*)::int AS effort_count,
           min(kom_rank) AS kom_rank, min(ride_date) AS first_ride_date
    FROM eff GROUP BY 1, 2, 3
  ),
  best AS (
    SELECT DISTINCT ON (segment_id, user_id, year) *
    FROM eff
    ORDER BY segment_id, user_id, year, elapsed_time_seconds, ride_date, id
  ),
  ins AS (
    INSERT INTO segment_bests (segment_id, user_id, year, effort_id, ride_id, ride_date,
      elapsed_time_seconds, average_watts, kom_rank, effort_count, first_ride_date)
    SELECT b.segment_id, b.user_id, b.year, b.id, b.ride_id, b.ride_date,
           b.elapsed_time_seconds, b.average_watts, s.kom_rank, s.effort_count, s.first_ride_date
    FROM best b JOIN stats s USING (segment_id, user_id, year)
    ON CONFLICT (segment_id, user_id, year) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM ins
$$;
REVOKE EXECUTE ON FUNCTION rebuild_segment_bests_from_efforts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rebuild_segment_bests_from_efforts() TO service_role;

SELECT rebuild_segment_bests_from_efforts();
UPDATE segments s SET sf2g_rides = x.n
FROM (SELECT segment_id, count(DISTINCT ride_id)::int AS n FROM segment_efforts GROUP BY 1) x
WHERE x.segment_id = s.id;

-- ------------------------------------------------------------
-- 5. Ingest of one ride, in one transaction:
--    lock the ride; skip if already fetched (so a retried job never counts
--    twice); upsert its segments; count the ride on each segment; fold its
--    efforts into segment_bests (private/hidden rides store none); mark it
--    fetched; queue KOM refreshes for up to 3 new corridor segments.
--
--    p_segments: [{id, name, distance_meters, average_grade, maximum_grade,
--                  elevation_high, elevation_low, climb_category, start_latlng,
--                  end_latlng, hazardous, corridor, direction, along_start_m,
--                  along_end_m, in_core}]
--    p_efforts:  [{id, segment_id, elapsed_time_seconds, average_watts, kom_rank}]
-- ------------------------------------------------------------
CREATE FUNCTION ingest_ride_segment_efforts(p_ride_id uuid, p_segments jsonb, p_efforts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r rides%ROWTYPE;
  n_bests int := 0;
  n_xoms int := 0;
  s record;
BEGIN
  SELECT * INTO r FROM rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ride_missing');
  END IF;
  IF r.segment_efforts_fetched_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'skipped');
  END IF;

  INSERT INTO segments (id, name, distance_meters, average_grade, maximum_grade,
    elevation_high, elevation_low, climb_category, start_latlng, end_latlng, hazardous,
    corridor, direction, along_start_m, along_end_m, in_core, updated_at)
  SELECT x.id, x.name, x.distance_meters, x.average_grade, x.maximum_grade,
    x.elevation_high, x.elevation_low, x.climb_category, x.start_latlng, x.end_latlng,
    coalesce(x.hazardous, false), x.corridor, x.direction, x.along_start_m, x.along_end_m,
    coalesce(x.in_core, false), now()
  FROM jsonb_to_recordset(coalesce(p_segments, '[]')) AS x(
    id bigint, name text, distance_meters real, average_grade real, maximum_grade real,
    elevation_high real, elevation_low real, climb_category smallint, start_latlng jsonb,
    end_latlng jsonb, hazardous boolean, corridor text, direction text,
    along_start_m real, along_end_m real, in_core boolean)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name, distance_meters = excluded.distance_meters,
    average_grade = excluded.average_grade, maximum_grade = excluded.maximum_grade,
    elevation_high = excluded.elevation_high, elevation_low = excluded.elevation_low,
    climb_category = excluded.climb_category, start_latlng = excluded.start_latlng,
    end_latlng = excluded.end_latlng, hazardous = excluded.hazardous,
    corridor = excluded.corridor, direction = excluded.direction,
    along_start_m = excluded.along_start_m, along_end_m = excluded.along_end_m,
    in_core = excluded.in_core, updated_at = now();

  CREATE TEMP TABLE _eff ON COMMIT DROP AS
  SELECT x.* FROM jsonb_to_recordset(coalesce(p_efforts, '[]')) AS x(
    id bigint, segment_id bigint, elapsed_time_seconds int, average_watts real, kom_rank smallint)
  WHERE x.segment_id IN (SELECT (j ->> 'id')::bigint FROM jsonb_array_elements(coalesce(p_segments, '[]')) j);

  UPDATE segments SET sf2g_rides = sf2g_rides + 1
  WHERE id IN (SELECT DISTINCT segment_id FROM _eff);

  IF r.is_private IS NOT TRUE AND r.is_hidden IS NOT TRUE THEN
    WITH per_segment AS (
      SELECT DISTINCT ON (segment_id) segment_id, id, elapsed_time_seconds, average_watts,
             count(*) OVER (PARTITION BY segment_id)::int AS n,
             min(kom_rank) OVER (PARTITION BY segment_id) AS kom_rank
      FROM _eff
      ORDER BY segment_id, elapsed_time_seconds, id
    ),
    up AS (
      INSERT INTO segment_bests AS b (segment_id, user_id, year, effort_id, ride_id, ride_date,
        elapsed_time_seconds, average_watts, kom_rank, effort_count, first_ride_date)
      SELECT p.segment_id, r.user_id, extract(year FROM r.ride_date)::smallint, p.id, r.id,
             r.ride_date, p.elapsed_time_seconds, p.average_watts, p.kom_rank, p.n, r.ride_date
      FROM per_segment p
      ON CONFLICT (segment_id, user_id, year) DO UPDATE SET
        effort_count = b.effort_count + excluded.effort_count,
        first_ride_date = least(b.first_ride_date, excluded.first_ride_date),
        kom_rank = least(b.kom_rank, excluded.kom_rank),
        -- A strictly faster effort replaces the best; on a tie the earlier ride keeps it.
        effort_id = CASE WHEN (excluded.elapsed_time_seconds, excluded.ride_date)
                              < (b.elapsed_time_seconds, b.ride_date)
                         THEN excluded.effort_id ELSE b.effort_id END,
        ride_id = CASE WHEN (excluded.elapsed_time_seconds, excluded.ride_date)
                            < (b.elapsed_time_seconds, b.ride_date)
                       THEN excluded.ride_id ELSE b.ride_id END,
        average_watts = CASE WHEN (excluded.elapsed_time_seconds, excluded.ride_date)
                                  < (b.elapsed_time_seconds, b.ride_date)
                             THEN excluded.average_watts ELSE b.average_watts END,
        ride_date = CASE WHEN (excluded.elapsed_time_seconds, excluded.ride_date)
                              < (b.elapsed_time_seconds, b.ride_date)
                         THEN excluded.ride_date ELSE b.ride_date END,
        elapsed_time_seconds = least(b.elapsed_time_seconds, excluded.elapsed_time_seconds)
      RETURNING 1
    )
    SELECT count(*) INTO n_bests FROM up;
  END IF;

  UPDATE rides SET segment_efforts_fetched_at = now() WHERE id = p_ride_id;

  FOR s IN
    SELECT id FROM segments
    WHERE id IN (SELECT DISTINCT segment_id FROM _eff)
      AND corridor IS NOT NULL AND xoms_fetched_at IS NULL
    ORDER BY id
    LIMIT 3
  LOOP
    IF enqueue_sync_job('segment_xoms', r.user_id, jsonb_build_object('segment_id', s.id)) THEN
      n_xoms := n_xoms + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'stored', 'bests', n_bests, 'xoms_enqueued', n_xoms);
END;
$$;
REVOKE EXECUTE ON FUNCTION ingest_ride_segment_efforts(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_ride_segment_efforts(uuid, jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 6. Invalidation. A best that leaves (ride deleted, made private or
--    hidden) cannot be replaced from stored data, because slower efforts
--    are not kept. So that rider's bests for that year are dropped and
--    their other fetched rides of that year are marked unfetched; the
--    backfill rebuilds them exactly (a few dozen Strava reads, rarely).
--    A ride that becomes public/visible again is simply refetched.
-- ------------------------------------------------------------
CREATE FUNCTION invalidate_segment_bests_year(p_user_id uuid, p_year int, p_except_ride uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  DELETE FROM segment_bests WHERE user_id = p_user_id AND year = p_year;
  UPDATE rides SET segment_efforts_fetched_at = NULL
  WHERE user_id = p_user_id
    AND id IS DISTINCT FROM p_except_ride
    AND segment_efforts_fetched_at IS NOT NULL
    AND extract(year FROM ride_date) = p_year;
$$;
REVOKE EXECUTE ON FUNCTION invalidate_segment_bests_year(uuid, int, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION segment_bests_on_ride_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM segment_bests WHERE ride_id = OLD.id) THEN
      PERFORM invalidate_segment_bests_year(OLD.user_id, extract(year FROM OLD.ride_date)::int, OLD.id);
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE OF is_private, is_hidden
  IF (NEW.is_private IS TRUE AND OLD.is_private IS NOT TRUE)
     OR (NEW.is_hidden IS TRUE AND OLD.is_hidden IS NOT TRUE) THEN
    IF EXISTS (SELECT 1 FROM segment_bests WHERE ride_id = NEW.id) THEN
      PERFORM invalidate_segment_bests_year(NEW.user_id, extract(year FROM NEW.ride_date)::int, NULL);
      -- This ride stays fetched: as private/hidden it stores nothing anyway.
      UPDATE rides SET segment_efforts_fetched_at = now() WHERE id = NEW.id;
    END IF;
  ELSIF NEW.is_private IS NOT TRUE AND NEW.is_hidden IS NOT TRUE
        AND (OLD.is_private IS TRUE OR OLD.is_hidden IS TRUE)
        AND NEW.segment_efforts_fetched_at IS NOT NULL THEN
    UPDATE rides SET segment_efforts_fetched_at = NULL WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION segment_bests_on_ride_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_rides_segment_bests_delete
  BEFORE DELETE ON rides
  FOR EACH ROW EXECUTE FUNCTION segment_bests_on_ride_change();
CREATE TRIGGER trg_rides_segment_bests_visibility
  AFTER UPDATE OF is_private, is_hidden ON rides
  FOR EACH ROW EXECUTE FUNCTION segment_bests_on_ride_change();

-- ------------------------------------------------------------
-- 7. Which rides are fetched, and the self-running backfill
-- ------------------------------------------------------------
-- Route categories whose rides get their segment efforts fetched. 09b adds
-- bayway and hmbw once their reference lines exist.
CREATE FUNCTION segment_ingest_categories()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT ARRAY['skyline']::text[] $$;

DROP INDEX IF EXISTS idx_rides_segment_pending;
CREATE INDEX idx_rides_segment_pending ON rides (route_category, start_date DESC)
  WHERE segment_efforts_fetched_at IS NULL
    AND route_category IN ('skyline', 'bayway', 'hmbw');

CREATE OR REPLACE FUNCTION enqueue_segment_efforts_for_ride() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.route_category = ANY (segment_ingest_categories()) THEN
    PERFORM enqueue_sync_job('segment_efforts', NEW.user_id, jsonb_build_object('ride_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_rides_segment_efforts ON rides;
CREATE TRIGGER trg_rides_segment_efforts
  AFTER INSERT OR UPDATE OF route_category ON rides
  FOR EACH ROW
  WHEN (NEW.route_category IS NOT NULL AND NEW.segment_efforts_fetched_at IS NULL)
  EXECUTE FUNCTION enqueue_segment_efforts_for_ride();

-- Unfetched rides, in this order: first a sample of each category until it
-- has SEGMENT_SAMPLE_RIDES fetched (so curation has data on every route),
-- then everyone newest first. Riders who hid their times come last.
CREATE OR REPLACE FUNCTION enqueue_segment_backfill(p_limit int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created int := 0;
  r record;
BEGIN
  FOR r IN
    WITH fetched AS (
      SELECT route_category, count(*) AS n FROM rides
      WHERE segment_efforts_fetched_at IS NOT NULL
        AND route_category = ANY (segment_ingest_categories())
      GROUP BY 1
    )
    SELECT rd.id, rd.user_id
    FROM rides rd
    JOIN users u ON u.id = rd.user_id
    LEFT JOIN fetched f ON f.route_category = rd.route_category
    WHERE rd.segment_efforts_fetched_at IS NULL
      AND rd.route_category = ANY (segment_ingest_categories())
      AND rd.route_category IN ('skyline', 'bayway', 'hmbw')   -- matches idx_rides_segment_pending
      AND u.deauthorized_at IS NULL AND NOT u.needs_reauth
      AND NOT EXISTS (SELECT 1 FROM sync_jobs j
                      WHERE j.kind = 'segment_efforts' AND j.status = 'failed'
                        AND j.payload ->> 'ride_id' = rd.id::text)
    ORDER BY (coalesce(f.n, 0) < 150) DESC, u.segment_board_hidden, rd.start_date DESC
    LIMIT greatest(p_limit, 0)
  LOOP
    IF enqueue_sync_job('segment_efforts', r.user_id, jsonb_build_object('ride_id', r.id)) THEN
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- One call per scheduled tick for all segment planning: KOM refreshes (as
-- enqueue_due_segment_xoms) and, while fewer than p_max_open segment_efforts
-- jobs are open, the next p_backfill rides. The drain stops at 85 % of
-- Strava's limits, so this never starves rider syncs.
CREATE FUNCTION plan_segment_jobs(
  p_xoms_older_than interval DEFAULT interval '7 days',
  p_xoms_limit int DEFAULT 5,
  p_backfill int DEFAULT 5,
  p_max_open int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  xoms int;
  open_jobs int;
  backfill int := 0;
BEGIN
  xoms := enqueue_due_segment_xoms(p_xoms_older_than, p_xoms_limit);
  SELECT count(*) INTO open_jobs FROM sync_jobs
  WHERE kind = 'segment_efforts' AND status IN ('queued', 'running');
  IF open_jobs < p_max_open THEN
    backfill := enqueue_segment_backfill(least(p_backfill, p_max_open - open_jobs));
  END IF;
  RETURN jsonb_build_object('xoms', xoms, 'backfill', backfill, 'open', open_jobs);
END;
$$;

-- ------------------------------------------------------------
-- 8. get_segment_leaderboard on segment_bests. Output unchanged. Riders who
--    hid their times are left out (segment_board_opt_in is no longer read).
--    The date filter keeps bests whose ride falls in the range; with yearly
--    bests that is exact for whole years (09c replaces the range with a year).
-- ------------------------------------------------------------
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
eligible AS (
  SELECT b.segment_id, b.user_id, b.elapsed_time_seconds, b.ride_date, b.effort_count,
         b.kom_rank, r.strava_activity_id
  FROM segment_bests b
  JOIN rides r ON r.id = b.ride_id
  JOIN users u ON u.id = b.user_id
  JOIN segments s ON s.id = b.segment_id
  CROSS JOIN p
  WHERE NOT u.segment_board_hidden
    AND u.deauthorized_at IS NULL
    AND r.is_private IS NOT TRUE
    AND r.is_hidden IS NOT TRUE
    AND s.corridor = p.corridor
    AND NOT s.hidden
    AND s.terrain <> 'descent'
    AND s.distance_meters >= 300   -- SEGMENT_MIN_DISTANCE_M
    AND NOT s.hazardous
    AND (p.terrain = 'all' OR s.terrain = p.terrain)
    AND (p.direction = 'both' OR s.direction = p.direction)
    AND (p.date_from IS NULL OR b.ride_date >= p.date_from)
    AND (p.date_to IS NULL OR b.ride_date <= p.date_to)
),
best_effort AS (
  SELECT DISTINCT ON (segment_id, user_id)
    segment_id, user_id, elapsed_time_seconds AS best_seconds, ride_date AS best_date,
    strava_activity_id
  FROM eligible
  ORDER BY segment_id, user_id, elapsed_time_seconds, ride_date
),
effort_stats AS (
  SELECT segment_id, user_id, sum(effort_count) AS effort_count, min(kom_rank) AS kom_rank
  FROM eligible
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
      'start_latlng', s.start_latlng,
      'end_latlng', s.end_latlng,
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

-- ------------------------------------------------------------
-- 9. Admin helpers (service role)
-- ------------------------------------------------------------
-- Reclassification now also writes the along-track position and in_core.
DROP FUNCTION batch_update_segment_corridors(jsonb);
CREATE FUNCTION batch_update_segment_corridors(p_rows jsonb)
RETURNS int
LANGUAGE sql
SET search_path = public
AS $$
  WITH input AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      id bigint, corridor text, direction text,
      along_start_m real, along_end_m real, in_core boolean)
  ),
  updated AS (
    UPDATE segments s
    SET corridor = i.corridor,
        direction = i.direction,
        along_start_m = i.along_start_m,
        along_end_m = i.along_end_m,
        in_core = coalesce(i.in_core, false),
        updated_at = now()
    FROM input i
    WHERE s.id = i.id
      AND (s.corridor IS DISTINCT FROM i.corridor
        OR s.direction IS DISTINCT FROM i.direction
        OR s.along_start_m IS DISTINCT FROM i.along_start_m
        OR s.along_end_m IS DISTINCT FROM i.along_end_m
        OR s.in_core IS DISTINCT FROM coalesce(i.in_core, false))
    RETURNING 1
  )
  SELECT count(*)::int FROM updated
$$;

-- What curation (app/lib/segment-curation.ts) needs for one corridor: every
-- segment on it, with its ride share among fetched rides of that route in
-- that segment's direction (south = SF→G, north = G→SF).
CREATE FUNCTION segment_curation_input(p_corridor text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH totals AS (
    SELECT coalesce(commute_direction, 'sf2g') AS dir, count(*)::int AS n
    FROM rides
    WHERE route_category = p_corridor AND segment_efforts_fetched_at IS NOT NULL
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'distance_meters', s.distance_meters,
    'average_grade', s.average_grade, 'terrain', s.terrain, 'direction', s.direction,
    'along_start_m', s.along_start_m, 'along_end_m', s.along_end_m, 'in_core', s.in_core,
    'hazardous', s.hazardous, 'hidden', s.hidden, 'curated_rank', s.curated_rank,
    'athlete_count', s.athlete_count, 'sf2g_rides', s.sf2g_rides,
    'selectable', s.selectable, 'duplicate_of', s.duplicate_of,
    'ride_share', CASE WHEN coalesce(t.n, 0) = 0 THEN 0
                       ELSE round(least(1, s.sf2g_rides::numeric / t.n), 3) END
  ) ORDER BY s.along_start_m NULLS LAST, s.id), '[]'::jsonb)
  FROM segments s
  LEFT JOIN totals t ON t.dir = CASE s.direction WHEN 'north' THEN 'g2sf' ELSE 'sf2g' END
  WHERE s.corridor = p_corridor
$$;

-- [{id, selectable, duplicate_of}] for one corridor; every other segment of
-- the corridor becomes not selectable.
CREATE FUNCTION batch_update_segment_curation(p_corridor text, p_rows jsonb)
RETURNS int
LANGUAGE sql
SET search_path = public
AS $$
  WITH input AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(id bigint, selectable boolean, duplicate_of bigint)
  ),
  target AS (
    SELECT s.id, coalesce(i.selectable, false) AS selectable, i.duplicate_of
    FROM segments s
    LEFT JOIN input i ON i.id = s.id
    WHERE s.corridor = p_corridor
  ),
  updated AS (
    UPDATE segments s
    SET selectable = t.selectable, duplicate_of = t.duplicate_of, updated_at = now()
    FROM target t
    WHERE s.id = t.id
      AND (s.selectable IS DISTINCT FROM t.selectable OR s.duplicate_of IS DISTINCT FROM t.duplicate_of)
    RETURNING 1
  )
  SELECT count(*)::int FROM updated
$$;

-- Admin curation overrides (09a §4.2): hidden = never selectable,
-- curated_rank = always selectable (and its order).
CREATE FUNCTION set_segment_curation(p_id bigint, p_hidden boolean, p_curated_rank int)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE segments SET hidden = p_hidden, curated_rank = p_curated_rank, updated_at = now()
  WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION segment_ingest_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'rides_pending', (SELECT count(*) FROM rides
                      WHERE route_category = ANY (segment_ingest_categories())
                        AND segment_efforts_fetched_at IS NULL),
    'rides_fetched', (SELECT count(*) FROM rides WHERE segment_efforts_fetched_at IS NOT NULL),
    'segments_total', (SELECT count(*) FROM segments),
    'segments_corridor', (SELECT count(*) FROM segments WHERE corridor IS NOT NULL),
    'segments_core', (SELECT count(*) FROM segments WHERE in_core),
    'segments_selectable', (SELECT count(*) FROM segments WHERE selectable),
    'efforts', (SELECT count(*) FROM segment_efforts),
    'bests', (SELECT count(*) FROM segment_bests),
    'open_jobs', (SELECT count(*) FROM sync_jobs
                  WHERE kind IN ('segment_efforts', 'segment_xoms') AND status IN ('queued', 'running')),
    'failed_jobs', (SELECT count(*) FROM sync_jobs
                    WHERE kind IN ('segment_efforts', 'segment_xoms') AND status = 'failed')
  )
$$;

REVOKE EXECUTE ON FUNCTION plan_segment_jobs(interval, int, int, int),
  segment_ingest_categories(), batch_update_segment_corridors(jsonb),
  segment_curation_input(text), batch_update_segment_curation(text, jsonb),
  set_segment_curation(bigint, boolean, int), segment_ingest_stats(),
  enqueue_segment_backfill(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION plan_segment_jobs(interval, int, int, int),
  segment_ingest_categories(), batch_update_segment_corridors(jsonb),
  segment_curation_input(text), batch_update_segment_curation(text, jsonb),
  set_segment_curation(bigint, boolean, int), segment_ingest_stats(),
  enqueue_segment_backfill(int)
  TO service_role;
