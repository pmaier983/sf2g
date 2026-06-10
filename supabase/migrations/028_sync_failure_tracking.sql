-- Migration: Add sync failure tracking columns
-- Purpose: Track consecutive sync failures to identify and clean up stale/deauthorized users.
-- When a user revokes Strava access from strava.com (not through our app),
-- the cron sync detects the failure and increments the counter.
-- After 3 consecutive failures, the user is auto-cleaned up.

ALTER TABLE users ADD COLUMN IF NOT EXISTS consecutive_sync_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deauthorized_at TIMESTAMPTZ;
