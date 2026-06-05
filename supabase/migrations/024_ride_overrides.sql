-- Ride overrides: user-applied edits that survive Strava syncs
CREATE TABLE IF NOT EXISTS ride_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Override fields (NULL means 'no override, use synced value')
  override_name TEXT,
  override_route_category TEXT CHECK (
    override_route_category IS NULL OR
    override_route_category IN ('bayway', 'skyline', 'hmbw', 'royale', 'fleaway', 'mebw', 'febw', 'other')
  ),
  is_hidden BOOLEAN DEFAULT false,
  is_not_sf2g BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,

  UNIQUE(ride_id, user_id)
);

ALTER TABLE ride_overrides ENABLE ROW LEVEL SECURITY;

-- Public reads needed for leaderboard filtering (hidden rides)
CREATE POLICY "Public read ride_overrides" ON ride_overrides
  FOR SELECT USING (true);

-- Only service role writes (server functions validate ownership)

-- Add is_hidden column directly on rides table for efficient leaderboard filtering
ALTER TABLE rides ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
