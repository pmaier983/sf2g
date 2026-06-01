-- ============================================================
-- Migration 013: Fix "Other" rides classification
-- ============================================================
-- Updates batch_update_ride_classifications to handle null
-- route_category (empty string → NULL). This ensures non-SF2G
-- rides get route_category=NULL, while valid SF2G commutes
-- on unrecognized routes keep route_category='other'.
--
-- Also updates existing rides that were incorrectly classified
-- as 'other' with confidence=0 (these are non-SF2G rides that
-- should have route_category=NULL).

-- 1. Update the batch RPC to handle null route_category via NULLIF
CREATE OR REPLACE FUNCTION batch_update_ride_classifications(
  updates JSONB
)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE rides AS r
  SET
    route_category           = NULLIF(u.route_category, '')::route_category,
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

-- 2. Fix existing rides: set route_category=NULL for rides that
--    were classified as 'other' with confidence=0 (non-SF2G rides)
UPDATE rides
SET route_category = NULL
WHERE route_category = 'other'
  AND classification_confidence = 0;

-- 3. Refresh the leaderboard to reflect the changes
SELECT refresh_leaderboard();
