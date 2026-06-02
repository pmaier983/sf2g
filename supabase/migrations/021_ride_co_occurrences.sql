-- Materialized view: candidate co-ride pairs (Layer 1 + Layer 2)
--
-- Pre-computes ride pairs where two different riders:
--   Layer 1: Same calendar date + same classified route category
--   Layer 2: Actual time window overlap (ride time intervals intersect)
--
-- The server function (app/server/network.ts) then applies Layer 3
-- (polyline GPS intersection analysis) on these candidates.
--
-- This MV is refreshed on the same cron schedule as leaderboard_view.
-- It does NOT use CONCURRENTLY because there is no UNIQUE INDEX
-- (multiple rows per rider pair — one per co-ride instance).

CREATE MATERIALIZED VIEW IF NOT EXISTS ride_co_occurrences AS
SELECT
  r1.id AS ride1_id,
  r1.user_id AS rider1_id,
  r2.id AS ride2_id,
  r2.user_id AS rider2_id,
  r1.route_category,
  r1.ride_date,
  r1.summary_polyline AS polyline1,
  r2.summary_polyline AS polyline2
FROM rides r1
JOIN rides r2
  ON r1.ride_date = r2.ride_date
  AND r1.route_category = r2.route_category
  AND r1.user_id < r2.user_id  -- avoid duplicates and self-joins
  AND r1.route_category != 'other'
  AND r1.route_category IS NOT NULL
  -- Layer 2: actual time window overlap
  -- Ride A's window: [start_date, start_date + elapsed_time_seconds]
  -- Ride B's window: [start_date, start_date + elapsed_time_seconds]
  -- Overlap exists when: A.start < B.end AND B.start < A.end
  AND r1.start_date < (r2.start_date + COALESCE(r2.elapsed_time_seconds, 0) * interval '1 second')
  AND r2.start_date < (r1.start_date + COALESCE(r1.elapsed_time_seconds, 0) * interval '1 second');

-- Indexes for efficient server-function queries
CREATE INDEX idx_co_occ_riders ON ride_co_occurrences (rider1_id, rider2_id);
CREATE INDEX idx_co_occ_date ON ride_co_occurrences (ride_date);

-- Refresh function (non-concurrent — no unique index)
CREATE OR REPLACE FUNCTION refresh_ride_co_occurrences()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW ride_co_occurrences;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
