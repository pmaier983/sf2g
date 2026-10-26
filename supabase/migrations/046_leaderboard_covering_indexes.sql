-- ============================================================
-- Migration 046: keep the leaderboard and community RPCs off the rides heap
-- ============================================================
-- Deploy order: independent of the app; apply any time after 038. Builds two
-- indexes on rides (seconds at today's ~78k rows; writes to rides wait for it).
--
-- Why: get_leaderboard and get_community_streaks hit the anon role's 3 s
-- statement_timeout in production (8 of 18 get_leaderboard calls and 3 of 5
-- get_community_streaks calls returned 500 on 2026-10-24/25). Warm, they take
-- ~0.2 s and ~1 s; the failures are the first request after a quiet spell,
-- when the pages are no longer cached on the Free (Nano) instance. Every call
-- read the whole rides heap (92 MB, ~1.2 kB per row because of polylines and
-- strava_raw) to use ~10k classified rows and a handful of narrow columns:
--
--   * sf2g_filtered_rides(q) had SET search_path, which stops Postgres from
--     inlining it, so it returned full rides.* rows into a tuplestore (the
--     temp-file spill seen in pg_stat_statements) and nothing could use an
--     index-only scan;
--   * all_ride_totals summed distance over every ride of every rider (78k
--     rows, heap again);
--   * the community functions scanned the heap for the classified rows.
--
-- Fix: covering indexes for exactly those reads, and an inlinable
-- sf2g_filtered_rides. No result changes.

-- Index builds below can exceed the API roles' statement timeout.
SET statement_timeout = 0;

-- ------------------------------------------------------------
-- 1. Eligible rides: classified, not hidden, not private
-- ------------------------------------------------------------
-- The predicate is written exactly as the functions write it so the planner
-- can prove it. INCLUDE lists every column get_leaderboard, career_years and
-- the community functions read, so they become index-only scans (~1 MB
-- instead of the heap).
CREATE INDEX IF NOT EXISTS idx_rides_eligible
  ON rides (user_id, ride_date)
  INCLUDE (route_category, destination_company, is_ppr_dawn, commute_direction,
           start_date, distance_meters, elevation_gain_meters, average_speed_mps,
           average_watts, average_heartrate, kilojoules)
  WHERE route_category IS NOT NULL
    AND NOT coalesce(is_hidden, false)
    AND NOT coalesce(is_private, false);

-- ------------------------------------------------------------
-- 2. All rides per rider (the % of distance / elevation denominator)
-- ------------------------------------------------------------
-- Same key as idx_rides_user_date (037), plus the two summed columns.
CREATE INDEX IF NOT EXISTS idx_rides_user_date_totals
  ON rides (user_id, ride_date)
  INCLUDE (distance_meters, elevation_gain_meters);
DROP INDEX IF EXISTS idx_rides_user_date;

-- ------------------------------------------------------------
-- 3. Inlinable sf2g_filtered_rides
-- ------------------------------------------------------------
-- Identical body to 038 with every name schema-qualified and no SET clause:
-- a SQL function with SET is never inlined. It is SECURITY INVOKER, so a
-- caller-controlled search_path cannot raise privileges (the reason the
-- advisor asks for SET search_path on definer functions).
CREATE OR REPLACE FUNCTION public.sf2g_filtered_rides(q jsonb)
RETURNS SETOF public.rides
LANGUAGE sql STABLE SECURITY INVOKER
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
  FROM public.rides r, p
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

ANALYZE rides;
