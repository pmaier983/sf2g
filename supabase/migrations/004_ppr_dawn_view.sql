-- Pre-filter rides that might pass through PPR around 6am.
-- The actual polyline proximity check happens server-side.
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
    EXTRACT(HOUR FROM r.start_date AT TIME ZONE COALESCE(r.timezone, 'America/Los_Angeles')) >= 4
    AND EXTRACT(HOUR FROM r.start_date AT TIME ZONE COALESCE(r.timezone, 'America/Los_Angeles')) <= 7
  )
  AND r.summary_polyline IS NOT NULL;

CREATE INDEX idx_ppr_dawn_rides_user_id ON ppr_dawn_rides(user_id);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_ppr_dawn_rides()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW ppr_dawn_rides;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
