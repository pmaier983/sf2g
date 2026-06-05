-- Audit log for ride override changes (tracks every modification a user makes)
CREATE TABLE IF NOT EXISTS ride_override_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What changed
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  override_name TEXT,
  override_route_category TEXT,
  is_hidden BOOLEAN,
  is_not_sf2g BOOLEAN,

  -- When
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE ride_override_audit_log ENABLE ROW LEVEL SECURITY;

-- Public read for transparency
CREATE POLICY "Public read ride_override_audit_log" ON ride_override_audit_log
  FOR SELECT USING (true);

-- Only service role writes (server functions handle this)

-- Index for querying by user or ride
CREATE INDEX IF NOT EXISTS idx_ride_override_audit_log_ride_id ON ride_override_audit_log(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_override_audit_log_user_id ON ride_override_audit_log(user_id);
