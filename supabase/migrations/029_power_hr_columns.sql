-- ============================================================
-- Migration 025: Add power & heart-rate columns to rides
-- ============================================================
-- These fields are available from Strava's activity summary
-- endpoint (/athlete/activities) and require NO extra API calls.
-- Not all riders have power meters or HR monitors, so every
-- column is nullable.

ALTER TABLE rides ADD COLUMN IF NOT EXISTS average_watts REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS max_watts REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS average_heartrate REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS max_heartrate REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS kilojoules REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS suffer_score REAL;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS has_power_meter BOOLEAN DEFAULT false;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS has_heartrate BOOLEAN DEFAULT false;

-- Index for efficient filtering / sorting by power availability
CREATE INDEX IF NOT EXISTS idx_rides_has_power ON rides (has_power_meter)
  WHERE has_power_meter = true;
