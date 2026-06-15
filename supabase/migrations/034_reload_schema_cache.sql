-- Reload PostgREST schema cache so it picks up the new
-- group_rides and group_ride_members tables.
NOTIFY pgrst, 'reload schema';
