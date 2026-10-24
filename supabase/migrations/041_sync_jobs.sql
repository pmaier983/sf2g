-- ============================================================
-- Migration 041: sync job queue (rework phase 04)
-- ============================================================
-- Strava work no longer runs inside request handlers. The webhook only
-- records a job; a Cloudflare Cron Trigger drains the queue every few
-- minutes in small batches that fit one Workers Free invocation. Jobs
-- resume where they stopped (cursor), back off on failure, and every rider's
-- sync health is visible.

-- ------------------------------------------------------------
-- 1. Rider sync health
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_reauth boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync_success_at timestamptz;

-- ------------------------------------------------------------
-- 2. Jobs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_jobs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'webhook_activity',   -- payload: { activity_id }
    'incremental',        -- new activities after the rider's last one
    'backfill',           -- cursor: { before } — older history, page by page
    'deauthorize',        -- rider revoked access on strava.com
    'refresh_views',      -- materialized views (once, after rides changed)
    'recompute_groups'    -- group rides (after refresh_views)
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_due ON sync_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_user ON sync_jobs (user_id, kind);

-- At most one open job per rider and kind (webhook jobs: per activity), and
-- one open global maintenance job of each kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_jobs_open_user_kind
  ON sync_jobs (user_id, kind)
  WHERE status IN ('queued', 'running') AND kind IN ('incremental', 'backfill', 'deauthorize');
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_jobs_open_activity
  ON sync_jobs ((payload->>'activity_id'))
  WHERE status IN ('queued', 'running') AND kind = 'webhook_activity';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_jobs_open_global
  ON sync_jobs (kind)
  WHERE status IN ('queued', 'running') AND kind IN ('refresh_views', 'recompute_groups');

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) can read or write.
REVOKE ALL ON sync_jobs FROM anon, authenticated;

-- ------------------------------------------------------------
-- 3. Queue operations (service role only)
-- ------------------------------------------------------------
-- Claim up to n due jobs atomically. Jobs stuck in 'running' for 10 minutes
-- (a crashed invocation) are claimable again.
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
      -- user-visible work first: new rides from webhooks, then catch-up
      CASE kind WHEN 'webhook_activity' THEN 0 WHEN 'deauthorize' THEN 1
                WHEN 'incremental' THEN 2 WHEN 'backfill' THEN 3 ELSE 4 END,
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

-- Insert a job unless an equivalent one is already open. Returns true if a
-- new job was created.
CREATE OR REPLACE FUNCTION enqueue_sync_job(
  p_kind text,
  p_user_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_cursor jsonb DEFAULT '{}'::jsonb,
  p_run_after timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO sync_jobs (kind, user_id, payload, cursor, run_after)
  VALUES (p_kind, p_user_id, coalesce(p_payload, '{}'), coalesce(p_cursor, '{}'), p_run_after);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;

-- Webhook entry point: one call, no Strava requests. Unknown athletes are
-- ignored. Returns what happened, for the response body and logs.
CREATE OR REPLACE FUNCTION enqueue_webhook_event(
  p_object_type text,
  p_aspect_type text,
  p_object_id bigint,
  p_owner_id bigint,
  p_updates jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  uid uuid;
  deleted int;
BEGIN
  SELECT id INTO uid FROM users WHERE strava_id = p_owner_id;
  IF uid IS NULL THEN
    RETURN 'ignored_unknown_user';
  END IF;

  IF p_object_type = 'athlete' THEN
    IF coalesce(p_updates->>'authorized', '') = 'false' THEN
      PERFORM enqueue_sync_job('deauthorize', uid);
      RETURN 'deauthorize_queued';
    END IF;
    RETURN 'ignored_athlete_update';
  END IF;

  IF p_object_type <> 'activity' THEN
    RETURN 'ignored_object_type';
  END IF;

  IF p_aspect_type = 'delete' THEN
    DELETE FROM rides WHERE strava_activity_id = p_object_id AND user_id = uid;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    IF deleted > 0 THEN
      PERFORM enqueue_sync_job('refresh_views');
    END IF;
    RETURN CASE WHEN deleted > 0 THEN 'ride_deleted' ELSE 'ride_not_found' END;
  END IF;

  IF p_aspect_type IN ('create', 'update') THEN
    IF enqueue_sync_job('webhook_activity', uid, jsonb_build_object('activity_id', p_object_id)) THEN
      RETURN 'activity_queued';
    END IF;
    RETURN 'activity_already_queued';
  END IF;

  RETURN 'ignored_aspect_type';
END;
$$;

-- Daily sweep: queue an incremental sync for riders not synced recently.
-- Called by the scheduler; returns how many jobs it created.
CREATE OR REPLACE FUNCTION enqueue_due_syncs(p_older_than interval DEFAULT interval '12 hours', p_limit int DEFAULT 20)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT u.id
    FROM users u
    WHERE u.strava_refresh_token <> ''
      AND u.strava_scopes ILIKE '%activity:read_all%'
      AND u.deauthorized_at IS NULL
      AND NOT u.needs_reauth
      AND (u.last_sync_at IS NULL OR u.last_sync_at < now() - p_older_than)
      AND NOT EXISTS (
        SELECT 1 FROM sync_jobs j
        WHERE j.user_id = u.id AND j.kind IN ('incremental', 'backfill')
          AND j.status IN ('queued', 'running')
      )
    ORDER BY u.last_sync_at NULLS FIRST
    LIMIT p_limit
  LOOP
    IF enqueue_sync_job('incremental', r.id) THEN
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- Re-apply a rider's manual ride edits after their rides were (re)written
-- from Strava. One statement instead of one request per override.
CREATE OR REPLACE FUNCTION reapply_ride_overrides(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE rides r
  SET name = coalesce(o.override_name, r.name),
      route_category = CASE
        WHEN o.is_not_sf2g THEN NULL
        WHEN o.override_route_category IS NOT NULL THEN o.override_route_category
        ELSE r.route_category END,
      is_hidden = CASE WHEN o.is_hidden THEN true ELSE r.is_hidden END
  FROM ride_overrides o
  WHERE o.ride_id = r.id AND o.user_id = p_user_id
    AND (o.override_name IS NOT NULL OR o.is_not_sf2g
         OR o.override_route_category IS NOT NULL OR o.is_hidden);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Per-rider sync health for the DevTools panel.
CREATE OR REPLACE VIEW sync_health
WITH (security_invoker = true) AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.last_sync_at,
  u.last_sync_success_at,
  u.last_activity_at,
  u.needs_reauth,
  u.deauthorized_at,
  u.consecutive_sync_failures,
  u.last_sync_error,
  (SELECT count(*) FROM sync_jobs j WHERE j.user_id = u.id AND j.status IN ('queued', 'running')) AS open_jobs,
  (SELECT count(*) FROM sync_jobs j WHERE j.user_id = u.id AND j.status = 'failed') AS failed_jobs
FROM users u;

REVOKE ALL ON sync_health FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_sync_jobs(int), enqueue_sync_job(text, uuid, jsonb, jsonb, timestamptz),
  enqueue_webhook_event(text, text, bigint, bigint, jsonb), enqueue_due_syncs(interval, int),
  reapply_ride_overrides(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_sync_jobs(int), enqueue_sync_job(text, uuid, jsonb, jsonb, timestamptz),
  enqueue_webhook_event(text, text, bigint, bigint, jsonb), enqueue_due_syncs(interval, int),
  reapply_ride_overrides(uuid)
  TO service_role;
GRANT SELECT ON sync_health TO service_role;
GRANT ALL ON sync_jobs TO service_role;
GRANT USAGE ON SEQUENCE sync_jobs_id_seq TO service_role;

-- Initial catch-up: one incremental job per connected rider, and a backfill
-- for riders whose first import never finished (last_sync_at was never set
-- although rides exist — their history beyond the first import is missing).
INSERT INTO sync_jobs (kind, user_id)
SELECT 'incremental', u.id FROM users u
WHERE u.strava_refresh_token <> '' AND u.deauthorized_at IS NULL
  AND u.strava_scopes ILIKE '%activity:read_all%'
ON CONFLICT DO NOTHING;

INSERT INTO sync_jobs (kind, user_id, cursor, run_after)
SELECT 'backfill', u.id,
       jsonb_build_object('before', extract(epoch FROM min(r.start_date))::bigint),
       now() + interval '1 hour'
FROM users u JOIN rides r ON r.user_id = u.id
WHERE u.last_sync_at IS NULL AND u.deauthorized_at IS NULL
  AND u.strava_scopes ILIKE '%activity:read_all%'
GROUP BY u.id
ON CONFLICT DO NOTHING;
