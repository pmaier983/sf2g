-- ============================================================
-- Migration 026: Create ride_streams table
-- ============================================================
-- Caches Strava activity stream data (GPS, time, power, HR)
-- fetched lazily when a user first views a group ride detail page.
-- Streams are immutable (ride GPS data never changes), so we
-- cache them permanently to avoid repeated Strava API calls.

CREATE TABLE IF NOT EXISTS ride_streams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,

  -- Core stream arrays (parallel arrays — same length, index-aligned)
  latlng_stream JSONB NOT NULL,      -- Array of [lat, lng] pairs
  time_stream JSONB NOT NULL,        -- Array of seconds from ride start

  -- Optional streams (not all riders have power meters / HR monitors)
  watts_stream JSONB,                -- Array of watts (nullable)
  heartrate_stream JSONB,            -- Array of BPM (nullable)

  fetched_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  -- One cached stream per ride
  UNIQUE(ride_id)
);

-- RLS: public reads (same pattern as rides table)
ALTER TABLE ride_streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read ride_streams" ON ride_streams
  FOR SELECT USING (true);

-- Index for quick lookups by ride_id (covered by UNIQUE constraint,
-- but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_ride_streams_ride_id ON ride_streams (ride_id);
