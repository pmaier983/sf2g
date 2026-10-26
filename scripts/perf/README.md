# RPC performance repro

Production runs on the Supabase Free (Nano) instance, where the first request
after a quiet spell finds `rides` uncached. A function that touches the whole
`rides` heap (~92 MB in production) then exceeds the anon role's 3 s
`statement_timeout`. "Buffers" below is the number of 8 kB pages a call touches,
which is what a cold cache has to read. Keep it small.

```bash
docker exec supabase_db_sf2g bash -c "dropdb -U postgres --if-exists sf2g_perf && createdb -U postgres sf2g_perf && pg_dump -U postgres -n public --no-privileges --no-owner postgres > /tmp/pub.sql && psql -U postgres -X -q sf2g_perf -f /tmp/pub.sql"
docker exec -i supabase_db_sf2g psql -U postgres -X -q sf2g_perf < scripts/perf/scale-rides.sql
docker exec -i supabase_db_sf2g psql -U postgres -X -q sf2g_perf < scripts/perf/measure-rpcs.sql
```

To compare a migration, apply it to `sf2g_perf` (`psql ... sf2g_perf < supabase/migrations/NNN_….sql`),
run `VACUUM ANALYZE rides`, and measure again. Drop the database when done:
`docker exec supabase_db_sf2g dropdb -U postgres sf2g_perf`.
