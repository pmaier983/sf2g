-- Pre-computed group rides table (populated by cron)
-- Stores clustered group ride summaries for fast paginated queries.

CREATE TABLE IF NOT EXISTS group_rides (
  id TEXT PRIMARY KEY,
  ride_date DATE NOT NULL,
  route_category TEXT NOT NULL,
  rider_count INTEGER NOT NULL DEFAULT 0,
  avg_speed_mps DOUBLE PRECISION,
  max_speed_mps DOUBLE PRECISION,
  avg_watts DOUBLE PRECISION,
  max_watts DOUBLE PRECISION,
  avg_heartrate DOUBLE PRECISION,
  total_distance_meters DOUBLE PRECISION,
  total_elevation_meters DOUBLE PRECISION,
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_ride_members (
  group_ride_id TEXT NOT NULL REFERENCES group_rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  PRIMARY KEY (group_ride_id, user_id)
);

-- Indexes for paginated queries
CREATE INDEX idx_group_rides_date ON group_rides (ride_date DESC);
CREATE INDEX idx_group_rides_route ON group_rides (route_category);
CREATE INDEX idx_group_ride_members_group ON group_ride_members (group_ride_id);

-- RLS: public reads, service role writes
ALTER TABLE group_rides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON group_rides FOR SELECT USING (true);

ALTER TABLE group_ride_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON group_ride_members FOR SELECT USING (true);
