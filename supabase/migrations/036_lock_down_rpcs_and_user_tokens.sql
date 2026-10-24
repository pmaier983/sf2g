-- Migration 036: Lock down write/refresh RPCs and pin function search_path
--
-- Supabase advisors flagged these SECURITY DEFINER functions as executable by
-- the `anon` and `authenticated` roles via /rest/v1/rpc/*. The anon key ships
-- in the client bundle, so anyone could rewrite ride classifications or force
-- expensive materialized-view refreshes. Every app call site uses the
-- service-role client (app/server/{reclassify,ride-overrides,auth,sync,cron}.ts
-- and app/scripts/*), so revoking from the public roles is safe.
--
-- Read RPCs used with the anon client stay executable:
--   get_leaderboard_by_date_range, get_user_ride_totals

-- 1. Revoke EXECUTE on mutating / refresh functions from public roles
REVOKE EXECUTE ON FUNCTION public.batch_update_ride_classifications(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_leaderboard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_company_leaderboard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_ppr_dawn_rides() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_ride_co_occurrences() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_route_speed_leaderboard() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.batch_update_ride_classifications(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_company_leaderboard() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ppr_dawn_rides() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ride_co_occurrences() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_route_speed_leaderboard() TO service_role;

-- 2. Pin search_path on every function flagged as role-mutable
ALTER FUNCTION public.batch_update_ride_classifications(jsonb) SET search_path = public;
ALTER FUNCTION public.refresh_leaderboard() SET search_path = public;
ALTER FUNCTION public.refresh_company_leaderboard() SET search_path = public;
ALTER FUNCTION public.refresh_ppr_dawn_rides() SET search_path = public;
ALTER FUNCTION public.refresh_ride_co_occurrences() SET search_path = public;
ALTER FUNCTION public.refresh_route_speed_leaderboard() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.get_user_ride_totals(date, date) SET search_path = public;
ALTER FUNCTION public.extract_iana_timezone(text) SET search_path = public;
ALTER FUNCTION public.get_leaderboard_by_date_range(date, date, boolean) SET search_path = public;

-- 3. Cover the ride_overrides.user_id foreign key (performance advisor)
CREATE INDEX IF NOT EXISTS idx_ride_overrides_user_id ON public.ride_overrides(user_id);

-- 4. Hide Strava OAuth tokens and sync diagnostics from the public roles.
--    The "Public read access for users" RLS policy is row-level only, so until
--    now `anon` could SELECT strava_access_token / strava_refresh_token for
--    every rider. Replace the table-level grant with a column allow-list that
--    matches PUBLIC_USER_COLUMNS in app/lib/public-user.ts.
--
--    DEPLOY ORDER: ship the app code that stops using select("*") on users
--    with the anon client (fetchUserProfile, getCurrentUser) BEFORE applying
--    this migration, or PostgREST `select=*` requests will fail with 42501.
REVOKE SELECT ON public.users FROM anon, authenticated;
GRANT SELECT (
  id, strava_id, username, first_name, last_name, display_name, avatar_url,
  last_sync_at, last_activity_at, created_at, updated_at
) ON public.users TO anon, authenticated;
