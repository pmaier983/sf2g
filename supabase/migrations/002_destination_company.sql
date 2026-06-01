-- ============================================================
-- SF2G Commute Tracker — Destination Company Classification
-- Migration: 002_destination_company.sql
--
-- Adds destination_company column to rides and a materialized
-- view for the company commute leaderboard (SF2[Company]).
-- ============================================================

-- ------------------------------------------------------------
-- Add destination_company to rides
-- ------------------------------------------------------------
ALTER TABLE rides
  ADD COLUMN destination_company TEXT
    CHECK (destination_company IN ('netflix', 'google', 'apple', 'meta', 'nvidia')),
  ADD COLUMN destination_office TEXT,
  ADD COLUMN destination_distance_meters REAL;

CREATE INDEX idx_rides_destination_company ON rides(destination_company);

-- ------------------------------------------------------------
-- Company Commute Leaderboard (materialized view)
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW company_leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,

  -- Total rides to any tracked company
  COUNT(r.id) FILTER (WHERE r.destination_company IS NOT NULL) AS total_company_rides,

  -- Per-company counts
  COUNT(r.id) FILTER (WHERE r.destination_company = 'netflix') AS netflix_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'google')  AS google_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'apple')   AS apple_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'meta')    AS meta_count,
  COUNT(r.id) FILTER (WHERE r.destination_company = 'nvidia')  AS nvidia_count,

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

-- ------------------------------------------------------------
-- Refresh function for company leaderboard
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_company_leaderboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY company_leaderboard_view;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- RLS Policies for new view
-- NOTE: Materialized views don't support RLS directly.
-- Access is controlled by the underlying table policies.
-- ------------------------------------------------------------
