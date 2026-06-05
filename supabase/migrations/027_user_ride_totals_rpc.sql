-- ============================================================
-- Migration 027: Add RPC for per-user ride totals
-- ============================================================
-- The Supabase REST API enforces a max_rows limit (default 1000)
-- that silently truncates client-side .limit() calls. This caused
-- the allRidesQuery in fetchFilteredLeaderboard to return at most
-- 1000 rides, making the % dist/elev denominator incorrect.
--
-- Fix: compute per-user totals in SQL via an RPC function that
-- aggregates on the database side (no row-count limit).

CREATE OR REPLACE FUNCTION get_user_ride_totals(
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  total_distance DOUBLE PRECISION,
  total_elevation DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.user_id,
    COALESCE(SUM(r.distance_meters), 0)::DOUBLE PRECISION AS total_distance,
    COALESCE(SUM(r.elevation_gain_meters), 0)::DOUBLE PRECISION AS total_elevation
  FROM rides r
  WHERE (p_date_from IS NULL OR r.ride_date >= p_date_from)
    AND (p_date_to IS NULL OR r.ride_date <= p_date_to)
  GROUP BY r.user_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
