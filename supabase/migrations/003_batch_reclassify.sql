-- ============================================================
-- SF2G Commute Tracker — Batch Reclassification RPC
-- Migration: 003_batch_reclassify.sql
--
-- Adds a PostgreSQL function for bulk-updating ride
-- classification columns in a single call, avoiding the
-- N+1 HTTP round-trip problem.
-- ============================================================

-- ------------------------------------------------------------
-- batch_update_ride_classifications
--
-- Accepts a JSONB array of objects with the shape:
--   { "id": UUID, "rc": text, "cc": real, "cm": text,
--     "dc": text|null, "do": text|null, "dd": real|null }
--
-- Performs a single UPDATE ... FROM unnest() to apply all
-- classification changes atomically.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION batch_update_ride_classifications(
  updates JSONB
)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE rides AS r
  SET
    route_category           = u.route_category,
    classification_confidence = u.classification_confidence,
    classification_method    = u.classification_method,
    destination_company      = u.destination_company,
    destination_office       = u.destination_office,
    destination_distance_meters = u.destination_distance_meters
  FROM (
    SELECT
      (elem ->> 'id')::UUID           AS id,
      (elem ->> 'rc')::TEXT           AS route_category,
      (elem ->> 'cc')::REAL          AS classification_confidence,
      (elem ->> 'cm')::TEXT           AS classification_method,
      NULLIF(elem ->> 'dc', '')::TEXT AS destination_company,
      NULLIF(elem ->> 'do', '')::TEXT AS destination_office,
      (elem ->> 'dd')::REAL          AS destination_distance_meters
    FROM jsonb_array_elements(updates) AS elem
  ) AS u
  WHERE r.id = u.id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
