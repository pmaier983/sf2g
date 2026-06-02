-- ============================================================
-- Migration 019: Add stanford + tesla to destination_company check constraint
-- ============================================================
-- The DestinationCompany type and office-locations.ts already include
-- 'stanford' and 'tesla', but the Postgres CHECK constraint on
-- rides.destination_company was never updated from the original set
-- of ('netflix', 'google', 'apple', 'meta', 'nvidia').
--
-- This caused: "new row for relation "rides" violates check constraint
-- "rides_destination_company_check"" when reclassifying rides that
-- end near Stanford or Tesla offices.

-- Drop the old constraint and add the updated one
ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_destination_company_check;

ALTER TABLE rides
  ADD CONSTRAINT rides_destination_company_check
    CHECK (destination_company IN ('netflix', 'google', 'apple', 'meta', 'nvidia', 'stanford', 'tesla'));

-- Also add per-company count columns for stanford and tesla to the
-- company_leaderboard_view materialized view so they appear in aggregates.
DROP MATERIALIZED VIEW IF EXISTS company_leaderboard_view;

CREATE MATERIALIZED VIEW company_leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,

  -- Total rides to any tracked company
  COUNT(r.id) FILTER (WHERE r.destination_company IS NOT NULL) AS total_company_rides,

  -- Per-company counts
  COUNT(r.id) FILTER (WHERE r.destination_company = 'netflix')  AS netflix_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'google')   AS google_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'apple')    AS apple_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'meta')     AS meta_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'nvidia')   AS nvidia_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'stanford') AS stanford_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'tesla')    AS tesla_count,

  -- Aggregate stats (only for company-destined rides)
  COALESCE(SUM(r.distance_meters) FILTER (WHERE r.destination_company IS NOT NULL), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters) FILTER (WHERE r.destination_company IS NOT NULL), 0) AS total_elevation_meters,
  COALESCE(AVG(r.average_speed_mps) FILTER (WHERE r.destination_company IS NOT NULL), 0) AS avg_speed_mps,

  MAX(r.ride_date) FILTER (WHERE r.destination_company IS NOT NULL) AS last_ride_date,
  MIN(r.ride_date) FILTER (WHERE r.destination_company IS NOT NULL) AS first_ride_date

FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username
HAVING COUNT(r.id) FILTER (WHERE r.destination_company IS NOT NULL) > 0;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_company_leaderboard_view_user_id
  ON company_leaderboard_view(user_id);
