-- ============================================================
-- SF2G Commute Tracker — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS TABLE
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strava_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT GENERATED ALWAYS AS (
    COALESCE(first_name || ' ' || last_name, username, 'Anonymous')
  ) STORED,
  avatar_url TEXT,

  -- Strava OAuth tokens (stored server-side only)
  strava_access_token TEXT NOT NULL,
  strava_refresh_token TEXT NOT NULL,
  strava_token_expires_at TIMESTAMPTZ NOT NULL,
  strava_scopes TEXT, -- comma-separated granted scopes

  -- Sync metadata
  last_sync_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ, -- timestamp of most recent synced activity

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_strava_id ON users(strava_id);

-- ============================================================
-- RIDES TABLE
-- ============================================================
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strava_activity_id BIGINT UNIQUE NOT NULL,

  -- Ride metadata
  name TEXT,
  ride_date DATE NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  timezone TEXT,

  -- Classification
  route_category TEXT CHECK (route_category IN ('bayway', 'skyline', 'hmbw', 'royale', 'other')),
  classification_confidence REAL, -- 0.0 to 1.0
  classification_method TEXT CHECK (classification_method IN ('gateway', 'elevation', 'manual')),

  -- Metrics
  distance_meters REAL,
  moving_time_seconds INTEGER,
  elapsed_time_seconds INTEGER,
  elevation_gain_meters REAL,
  average_speed_mps REAL, -- meters per second
  max_speed_mps REAL,

  -- GPS data
  start_latlng JSONB, -- [lat, lng]
  end_latlng JSONB,   -- [lat, lng]
  summary_polyline TEXT,

  -- Strava flags
  is_commute BOOLEAN DEFAULT false,
  is_private BOOLEAN DEFAULT false,

  -- Raw Strava data (for debugging / reprocessing)
  strava_raw JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rides_user_id ON rides(user_id);
CREATE INDEX idx_rides_ride_date ON rides(ride_date DESC);
CREATE INDEX idx_rides_route_category ON rides(route_category);
CREATE INDEX idx_rides_strava_activity_id ON rides(strava_activity_id);
CREATE INDEX idx_rides_start_date ON rides(start_date DESC);

-- NOTE: Route classification uses GPS gateway/checkpoint coordinates
-- defined in app/lib/constants.ts, NOT Strava segments.
-- No route_segments table needed.

-- ============================================================
-- LEADERBOARD MATERIALIZED VIEW
-- ============================================================
CREATE MATERIALIZED VIEW leaderboard_view AS
SELECT
  u.id AS user_id,
  u.display_name,
  u.avatar_url,
  u.username,
  COUNT(r.id) AS total_rides,
  COUNT(r.id) FILTER (WHERE r.route_category = 'bayway') AS bayway_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'skyline') AS skyline_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'hmbw') AS hmbw_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'royale') AS royale_count,
  COUNT(r.id) FILTER (WHERE r.route_category = 'other') AS other_count,
  COALESCE(SUM(r.distance_meters), 0) AS total_distance_meters,
  COALESCE(SUM(r.elevation_gain_meters), 0) AS total_elevation_meters,
  COALESCE(AVG(r.average_speed_mps), 0) AS avg_speed_mps,
  MAX(r.ride_date) AS last_ride_date,
  MIN(r.ride_date) AS first_ride_date
FROM users u
LEFT JOIN rides r ON u.id = r.user_id
GROUP BY u.id, u.display_name, u.avatar_url, u.username;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_leaderboard_view_user_id ON leaderboard_view(user_id);

-- ============================================================
-- MONTHLY STATS VIEW (for charts)
-- ============================================================
CREATE VIEW monthly_ride_stats AS
SELECT
  u.id AS user_id,
  DATE_TRUNC('month', r.ride_date) AS month,
  r.route_category,
  COUNT(*) AS ride_count,
  SUM(r.distance_meters) AS total_distance,
  AVG(r.average_speed_mps) AS avg_speed
FROM users u
JOIN rides r ON u.id = r.user_id
GROUP BY u.id, DATE_TRUNC('month', r.ride_date), r.route_category;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- Public reads: Anyone can view the leaderboard and ride data
CREATE POLICY "Public read access for users"
  ON users FOR SELECT
  USING (true);

CREATE POLICY "Public read access for rides"
  ON rides FOR SELECT
  USING (true);

-- Deny anon writes explicitly
CREATE POLICY "Deny anon insert on users"
  ON users FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny anon update on users"
  ON users FOR UPDATE
  USING (false);

CREATE POLICY "Deny anon insert on rides"
  ON rides FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Deny anon update on rides"
  ON rides FOR UPDATE
  USING (false);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to refresh leaderboard (called after sync)
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_view;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
