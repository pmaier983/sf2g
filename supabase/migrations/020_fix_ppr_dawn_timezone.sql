-- ============================================================
-- Fix PPR dawn rides view — extract IANA timezone from Strava format
-- Migration: 020_fix_ppr_dawn_timezone.sql
--
-- Strava stores timezone as "(GMT-08:00) America/Los_Angeles"
-- but PostgreSQL's AT TIME ZONE requires a valid IANA timezone
-- like "America/Los_Angeles". The original view passed the raw
-- Strava string, causing the hour extraction to fail and the
-- view to return no rows.
-- ============================================================

-- Drop the old materialized view and index
DROP INDEX IF EXISTS idx_ppr_dawn_rides_user_id;
DROP MATERIALIZED VIEW IF EXISTS ppr_dawn_rides;

-- Helper: extract IANA timezone from Strava's "(GMT-08:00) America/Los_Angeles" format.
-- Returns 'America/Los_Angeles' as the default fallback.
CREATE OR REPLACE FUNCTION extract_iana_timezone(tz TEXT)
RETURNS TEXT AS $$
BEGIN
  IF tz IS NULL OR tz = '' THEN
    RETURN 'America/Los_Angeles';
  END IF;
  -- Strava format: "(GMT-08:00) America/Los_Angeles"
  -- Extract everything after ") "
  RETURN COALESCE(
    NULLIF(TRIM(SUBSTRING(tz FROM '\)\s*(.+)$')), ''),
    'America/Los_Angeles'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Recreate the materialized view using the helper function
CREATE MATERIALIZED VIEW ppr_dawn_rides AS
SELECT
  r.id AS ride_id,
  r.user_id,
  r.start_date,
  r.start_latlng,
  r.summary_polyline,
  r.moving_time_seconds,
  r.timezone
FROM rides r
WHERE
  -- Morning window: rides starting between 4:30 AM and 7:30 AM local time
  -- (wide window to catch riders who start from home and pass PPR around 6am)
  (
    EXTRACT(HOUR FROM r.start_date AT TIME ZONE extract_iana_timezone(r.timezone)) >= 4
    AND EXTRACT(HOUR FROM r.start_date AT TIME ZONE extract_iana_timezone(r.timezone)) <= 7
  )
  AND r.summary_polyline IS NOT NULL;

CREATE INDEX idx_ppr_dawn_rides_user_id ON ppr_dawn_rides(user_id);

-- Update the refresh function
CREATE OR REPLACE FUNCTION refresh_ppr_dawn_rides()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW ppr_dawn_rides;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
