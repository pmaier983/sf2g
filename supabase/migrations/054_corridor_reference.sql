-- ============================================================
-- Migration 054: Bayway and HMBW corridors — reference-ride candidates
-- (rework phase 09b — docs/rework/phase-09-cumulative-segments.md §4.5)
-- ============================================================
-- Deploy order: any time after 051. Nothing changes for riders: Bayway and
-- HMBW segments are not fetched until their reference lines are committed
-- and segment_ingest_categories() is widened (a later migration).
--
-- 1. segments.corridor may be 'bayway' or 'hmbw'.
-- 2. corridor_reference_candidates(category, limit): the newest SF→G rides
--    of a route with their summary polylines, for the admin tool that picks
--    the most typical one (scored in the admin's browser). Service role only.

ALTER TABLE segments DROP CONSTRAINT IF EXISTS segments_corridor_check;
ALTER TABLE segments ADD CONSTRAINT segments_corridor_check
  CHECK (corridor IN ('skyline', 'bayway', 'hmbw'));

CREATE FUNCTION corridor_reference_candidates(p_category text, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'ride_id', r.id,
    'user_id', r.user_id,
    'display_name', u.display_name,
    'strava_activity_id', r.strava_activity_id,
    'ride_date', r.ride_date,
    'distance_meters', r.distance_meters,
    'summary_polyline', r.summary_polyline
  ) ORDER BY r.start_date DESC), '[]'::jsonb)
  FROM (
    SELECT * FROM rides
    WHERE route_category = p_category
      AND coalesce(commute_direction, 'sf2g') = 'sf2g'
      AND is_private IS NOT TRUE AND is_hidden IS NOT TRUE
      AND summary_polyline IS NOT NULL AND summary_polyline <> ''
    ORDER BY start_date DESC
    LIMIT least(greatest(p_limit, 1), 500)
  ) r
  JOIN users u ON u.id = r.user_id
  WHERE u.deauthorized_at IS NULL AND NOT u.needs_reauth
$$;

REVOKE EXECUTE ON FUNCTION corridor_reference_candidates(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION corridor_reference_candidates(text, int) TO service_role;
