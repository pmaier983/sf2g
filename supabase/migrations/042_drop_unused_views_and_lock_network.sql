-- ============================================================
-- Migration 042: drop unused materialized views, close the
-- "materialized view in API" advisor finding (rework phase 06b)
-- ============================================================
-- Deploy order: apply AFTER the app version from phase 06b is deployed.
-- Older app versions call refresh_leaderboard / refresh_company_leaderboard /
-- refresh_ppr_dawn_rides / refresh_route_speed_leaderboard and would log
-- (non-fatal) errors once these are gone.
--
-- Since phase 03 every leaderboard, rides, profile, network and group query
-- is computed from `rides` by a SQL function (037–040). These four
-- materialized views have no readers left, but were still refreshed after
-- every ride change — work and Worker subrequests for nothing:
--   leaderboard_view, company_leaderboard_view, ppr_dawn_rides,
--   route_speed_leaderboard
--
-- ride_co_occurrences stays (group rides and the rider network are built
-- from it). Its only public reader was get_rider_network(), a SECURITY
-- INVOKER function, which forced anon SELECT on the MV. The function now
-- runs as its owner (read-only, fixed search_path, returns only public
-- aggregates), so anon/authenticated lose direct access to the pair data.

DROP FUNCTION IF EXISTS refresh_leaderboard();
DROP FUNCTION IF EXISTS refresh_company_leaderboard();
DROP FUNCTION IF EXISTS refresh_ppr_dawn_rides();
DROP FUNCTION IF EXISTS refresh_route_speed_leaderboard();

DROP MATERIALIZED VIEW IF EXISTS leaderboard_view;
DROP MATERIALIZED VIEW IF EXISTS company_leaderboard_view;
DROP MATERIALIZED VIEW IF EXISTS ppr_dawn_rides;
DROP MATERIALIZED VIEW IF EXISTS route_speed_leaderboard;

ALTER FUNCTION get_rider_network() SECURITY DEFINER;
ALTER FUNCTION get_rider_network() SET search_path = public;
REVOKE EXECUTE ON FUNCTION get_rider_network() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rider_network() TO anon, authenticated, service_role;

REVOKE SELECT ON ride_co_occurrences FROM anon, authenticated;
REVOKE SELECT ON visible_ride_pairs FROM anon, authenticated;
REVOKE ALL ON ride_pair_overlap FROM anon, authenticated;
