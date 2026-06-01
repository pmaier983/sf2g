-- ============================================================
-- Migration 014: Fix batch_update_ride_classifications type cast
-- ============================================================
-- Migration 013 incorrectly used ::route_category enum cast,
-- but the column is TEXT. This fixes the function to use ::TEXT.

CREATE OR REPLACE FUNCTION batch_update_ride_classifications(
  updates JSONB
)
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE rides AS r
  SET
    route_category           = NULLIF(u.route_category, ''),
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
