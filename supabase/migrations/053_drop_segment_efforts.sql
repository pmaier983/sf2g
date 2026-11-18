-- ============================================================
-- Migration 053: remove what the cumulative leaderboard replaced
-- (rework phase 09e — docs/rework/phase-09-cumulative-segments.md)
-- ============================================================
-- Deploy order: deploy the 09e Worker FIRST (it no longer selects
-- users.segment_board_opt_in or calls get_segment_leaderboard), THEN apply
-- this migration. Applying it under an older Worker breaks getCurrentUser
-- (PUBLIC_USER_COLUMNS still names segment_board_opt_in) and /segments.
--
-- 1. get_segment_leaderboard: replaced by get_segment_matrix (052)
-- 2. segment_efforts: every effort; replaced by segment_bests (051). Nothing
--    has written it since 09a, and 051 carried its data over.
-- 3. users.segment_board_opt_in: replaced by segment_board_hidden (051)

DROP FUNCTION IF EXISTS get_segment_leaderboard(jsonb);
DROP FUNCTION IF EXISTS rebuild_segment_bests_from_efforts();
DROP TABLE IF EXISTS segment_efforts;

REVOKE SELECT (segment_board_opt_in) ON public.users FROM anon, authenticated;
ALTER TABLE users DROP COLUMN IF EXISTS segment_board_opt_in;

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
    'bests', (SELECT count(*) FROM segment_bests),
    'open_jobs', (SELECT count(*) FROM sync_jobs
                  WHERE kind IN ('segment_efforts', 'segment_xoms') AND status IN ('queued', 'running')),
    'failed_jobs', (SELECT count(*) FROM sync_jobs
                    WHERE kind IN ('segment_efforts', 'segment_xoms') AND status = 'failed')
  )
$$;
REVOKE EXECUTE ON FUNCTION segment_ingest_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION segment_ingest_stats() TO service_role;
