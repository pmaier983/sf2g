-- ============================================================
-- Fix SECURITY DEFINER warning on views
-- Migration: 011_fix_security_invoker_views.sql
--
-- Supabase linter flags views without an explicit
-- security_invoker setting. This ensures views run with
-- the permissions of the querying user (respecting RLS),
-- not the view owner.
-- ============================================================

ALTER VIEW monthly_ride_stats SET (security_invoker = on);
