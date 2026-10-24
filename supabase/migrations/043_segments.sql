-- ============================================================
-- Migration 043: Strava segments and riders' segment efforts
-- (rework phase 07a — data layer for the Skyline segment board)
-- ============================================================
-- Deploy order: apply this migration before deploying the Worker that
-- contains 07a; the trigger only inserts job kinds the migration adds.
--
-- Strava has no segment leaderboard endpoint any more (removed June 2020)
-- and /segments/explore is not available to this app, so the board is built
-- from each connected rider's own efforts: one
-- GET /activities/{id}?include_all_efforts=true per Skyline ride
-- ('segment_efforts' job) and one GET /segments/{id} per corridor segment
-- for its KOM/QOM times ('segment_xoms' job). Ranking happens in SQL (07b).

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE segments (
  id               bigint PRIMARY KEY,          -- Strava segment id
  name             text NOT NULL,
  distance_meters  real NOT NULL,
  average_grade    real NOT NULL,
  maximum_grade    real,
  elevation_high   real,
  elevation_low    real,
  climb_category   smallint,
  start_latlng     jsonb NOT NULL,              -- [lat, lng]
  end_latlng       jsonb NOT NULL,
  hazardous        boolean NOT NULL DEFAULT false,
  corridor         text CHECK (corridor IN ('skyline')),
  direction        text NOT NULL CHECK (direction IN ('south', 'north')),
  terrain          text GENERATED ALWAYS AS (
                     CASE WHEN average_grade >= 2 THEN 'climb'
                          WHEN average_grade >= -1 THEN 'flat'
                          ELSE 'descent' END) STORED,
  kom_seconds      int,
  qom_seconds      int,
  overall_seconds  int,
  effort_count     int,
  athlete_count    int,
  xoms_fetched_at  timestamptz,
  curated_rank     int,                         -- admin: order in the "core" section; NULL = not core
  hidden           boolean NOT NULL DEFAULT false,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_segments_corridor ON segments (corridor) WHERE corridor IS NOT NULL;

CREATE TABLE segment_efforts (
  id                   bigint PRIMARY KEY,      -- Strava effort id
  segment_id           bigint NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id              uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  elapsed_time_seconds int NOT NULL,
  moving_time_seconds  int,
  start_date           timestamptz NOT NULL,
  kom_rank             smallint,
  pr_rank              smallint,
  average_watts        real,
  device_watts         boolean
);
CREATE INDEX idx_segment_efforts_rank ON segment_efforts (segment_id, user_id, elapsed_time_seconds);
CREATE INDEX idx_segment_efforts_ride ON segment_efforts (ride_id);
CREATE INDEX idx_segment_efforts_user ON segment_efforts (user_id);

ALTER TABLE rides ADD COLUMN segment_efforts_fetched_at timestamptz;
CREATE INDEX idx_rides_segment_pending ON rides (start_date DESC)
  WHERE route_category = 'skyline' AND segment_efforts_fetched_at IS NULL;
ALTER TABLE users ADD COLUMN segment_board_opt_in boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 2. RLS: segments public; segment_efforts only via the RPC (07b)
-- ------------------------------------------------------------
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read segments" ON segments FOR SELECT USING (true);
ALTER TABLE segment_efforts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON segment_efforts FROM anon, authenticated;
GRANT ALL ON segments, segment_efforts TO service_role;

-- segment_board_opt_in is public and non-secret: extend the column allow-list
-- from migration 036 (keep in sync with PUBLIC_USER_COLUMNS in
-- app/lib/public-user.ts).
GRANT SELECT (segment_board_opt_in) ON public.users TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Job kinds
-- ------------------------------------------------------------
ALTER TABLE sync_jobs DROP CONSTRAINT sync_jobs_kind_check;
ALTER TABLE sync_jobs ADD CONSTRAINT sync_jobs_kind_check CHECK (kind IN (
  'webhook_activity','incremental','backfill','deauthorize','refresh_views','recompute_groups',
  'segment_efforts',   -- payload: { ride_id }
  'segment_xoms'       -- payload: { segment_id }, user_id = whose token to use
));
CREATE UNIQUE INDEX uq_sync_jobs_open_segment_ride ON sync_jobs ((payload->>'ride_id'))
  WHERE status IN ('queued','running') AND kind = 'segment_efforts';
CREATE UNIQUE INDEX uq_sync_jobs_open_segment_xoms ON sync_jobs ((payload->>'segment_id'))
  WHERE status IN ('queued','running') AND kind = 'segment_xoms';

-- Same as 041, with the segment kinds after backfill: rider syncs never wait
-- for segment work.
CREATE OR REPLACE FUNCTION claim_sync_jobs(n int)
RETURNS SETOF sync_jobs
LANGUAGE sql
SET search_path = public
AS $$
  -- MATERIALIZED: an `IN (SELECT … LIMIT … FOR UPDATE)` subquery can be
  -- re-evaluated by the planner and claim more than n rows.
  WITH picked AS MATERIALIZED (
    SELECT id FROM sync_jobs
    WHERE (status = 'queued' AND run_after <= now())
       OR (status = 'running' AND locked_at < now() - interval '10 minutes')
    ORDER BY
      -- user-visible work first: new rides from webhooks, then catch-up,
      -- then segment work
      CASE kind WHEN 'webhook_activity' THEN 0 WHEN 'deauthorize' THEN 1
                WHEN 'incremental' THEN 2 WHEN 'backfill' THEN 3
                WHEN 'segment_efforts' THEN 4 WHEN 'segment_xoms' THEN 5 ELSE 6 END,
      run_after, id
    LIMIT greatest(n, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE sync_jobs j
  SET status = 'running', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*
$$;

-- ------------------------------------------------------------
-- 4. Enqueue on new Skyline rides
-- ------------------------------------------------------------
CREATE FUNCTION enqueue_segment_efforts_for_ride() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM enqueue_sync_job('segment_efforts', NEW.user_id, jsonb_build_object('ride_id', NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rides_segment_efforts
  AFTER INSERT OR UPDATE OF route_category ON rides
  FOR EACH ROW
  WHEN (NEW.route_category = 'skyline' AND NEW.segment_efforts_fetched_at IS NULL)
  EXECUTE FUNCTION enqueue_segment_efforts_for_ride();
-- Re-upserts of an unfetched ride hit the unique index and are ignored
-- (enqueue_sync_job returns false).

-- ------------------------------------------------------------
-- 5. Planners (service role only, like enqueue_due_syncs)
-- ------------------------------------------------------------
-- Queue segment_efforts jobs for Skyline rides never fetched, opted-in
-- riders first, newest rides first. Returns how many jobs it created.
CREATE FUNCTION enqueue_segment_backfill(p_limit int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT rd.id, rd.user_id
    FROM rides rd
    JOIN users u ON u.id = rd.user_id
    WHERE rd.route_category = 'skyline' AND rd.segment_efforts_fetched_at IS NULL
    ORDER BY u.segment_board_opt_in DESC, rd.start_date DESC
    LIMIT greatest(p_limit, 0)
  LOOP
    IF enqueue_sync_job('segment_efforts', r.user_id, jsonb_build_object('ride_id', r.id)) THEN
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- Queue a KOM/QOM refresh for corridor segments not refreshed recently,
-- using the token of the most recently synced healthy rider.
CREATE FUNCTION enqueue_due_segment_xoms(p_older_than interval DEFAULT interval '7 days', p_limit int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created int := 0;
  token_user uuid;
  s record;
BEGIN
  SELECT id INTO token_user FROM users
  WHERE NOT needs_reauth AND deauthorized_at IS NULL AND strava_refresh_token <> ''
  ORDER BY last_sync_success_at DESC NULLS LAST
  LIMIT 1;
  IF token_user IS NULL THEN
    RETURN 0;
  END IF;

  FOR s IN
    SELECT id FROM segments
    WHERE corridor IS NOT NULL AND NOT hidden
      AND (xoms_fetched_at IS NULL OR xoms_fetched_at < now() - p_older_than)
    ORDER BY xoms_fetched_at NULLS FIRST, id
    LIMIT greatest(p_limit, 0)
  LOOP
    IF enqueue_sync_job('segment_xoms', token_user, jsonb_build_object('segment_id', s.id)) THEN
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- Counts for the DevTools "Segments" section: one call instead of five.
CREATE FUNCTION segment_ingest_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'rides_pending', (SELECT count(*) FROM rides
                      WHERE route_category = 'skyline' AND segment_efforts_fetched_at IS NULL),
    'rides_fetched', (SELECT count(*) FROM rides WHERE segment_efforts_fetched_at IS NOT NULL),
    'segments_total', (SELECT count(*) FROM segments),
    'segments_corridor', (SELECT count(*) FROM segments WHERE corridor IS NOT NULL),
    'efforts', (SELECT count(*) FROM segment_efforts),
    'open_jobs', (SELECT count(*) FROM sync_jobs
                  WHERE kind IN ('segment_efforts', 'segment_xoms') AND status IN ('queued', 'running')),
    'failed_jobs', (SELECT count(*) FROM sync_jobs
                    WHERE kind IN ('segment_efforts', 'segment_xoms') AND status = 'failed')
  )
$$;

REVOKE EXECUTE ON FUNCTION enqueue_segment_backfill(int), enqueue_due_segment_xoms(interval, int),
  segment_ingest_stats(), enqueue_segment_efforts_for_ride()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_segment_backfill(int), enqueue_due_segment_xoms(interval, int),
  segment_ingest_stats()
  TO service_role;
