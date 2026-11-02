-- Time and buffers touched (8 kB pages: what a cold cache must read) for the
-- RPCs the leaderboard pages call. Best of three runs. See scripts/perf/README.md.
\pset format unaligned
\pset tuples_only on
CREATE OR REPLACE FUNCTION pg_temp.measure(label text, sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE j json; best numeric := 1e9; ms numeric; buf int; tmp int;
BEGIN
  FOR i IN 1..3 LOOP
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || sql INTO j;
    ms := (j->0->>'Execution Time')::numeric;
    best := least(best, ms);
    buf := (j->0->'Plan'->>'Shared Hit Blocks')::int + (j->0->'Plan'->>'Shared Read Blocks')::int;
    tmp := (j->0->'Plan'->>'Temp Written Blocks')::int;
  END LOOP;
  RETURN rpad(label, 22) || ' best ' || lpad(round(best)::text, 5) || ' ms   buffers ' || lpad(buf::text, 6)
         || ' (' || round(buf * 8 / 1024.0, 1) || ' MB)   temp ' || tmp;
END $f$;
SELECT 'rides heap pages: ' || relpages || ' (' || pg_size_pretty(pg_relation_size('rides')) || ')' FROM pg_class WHERE relname = 'rides';
SELECT pg_temp.measure('leaderboard default', $$SELECT * FROM get_leaderboard('{"routes":[],"include_other":false,"exclude_weekends":true,"ppr":false,"reverse":false}')$$);
SELECT pg_temp.measure('leaderboard 2025', $$SELECT * FROM get_leaderboard('{"date_from":"2025-01-01","date_to":"2025-12-31"}')$$);
SELECT pg_temp.measure('community_streaks', $$SELECT get_community_streaks()$$);
SELECT pg_temp.measure('community_start_hours', $$SELECT get_community_start_hours()$$);
SELECT pg_temp.measure('community_breakdown', $$SELECT get_community_breakdown()$$);
