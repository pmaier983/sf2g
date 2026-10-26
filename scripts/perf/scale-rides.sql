-- Scale the fixture rides to production size (~78k rides, ~10k classified,
-- ~70 riders) in a throwaway database, for measuring RPC plans.
-- Never run against the `postgres` database other tests use, and never
-- against production. See scripts/perf/README.md.
SET session_replication_role = replica;
CREATE TEMP TABLE umap AS
SELECT u.id AS old_id, gen_random_uuid() AS new_id, k FROM users u, generate_series(1,7) k;
DO $$
DECLARE ucols text; rcols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO ucols
  FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND is_generated='NEVER';
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO rcols
  FROM information_schema.columns WHERE table_schema='public' AND table_name='rides' AND is_generated='NEVER';
  EXECUTE format($f$INSERT INTO users (%1$s) SELECT %1$s FROM (
      SELECT (jsonb_populate_record(u, jsonb_build_object('id', m.new_id, 'strava_id', u.strava_id + 1000000*m.k,
        'username', u.username || m.k))).* FROM users u JOIN umap m ON m.old_id = u.id) x$f$, ucols);
  INSERT INTO umap SELECT id, id, 0 FROM users WHERE id IN (SELECT old_id FROM umap);
  EXECUTE format($f$INSERT INTO rides (%1$s) SELECT %1$s FROM (
      SELECT (jsonb_populate_record(r, jsonb_build_object(
        'id', gen_random_uuid(), 'user_id', m.new_id,
        'strava_activity_id', r.strava_activity_id + 10000000::bigint*(m.k*1000+c),
        'ride_date', r.ride_date - (c*7), 'start_date', r.start_date - make_interval(days => c*7)))).*
      FROM rides r JOIN umap m ON m.old_id = r.user_id
      CROSS JOIN LATERAL generate_series(CASE WHEN m.k = 0 THEN 1 ELSE 0 END,
                                         CASE WHEN r.route_category IS NULL THEN 172 ELSE 3 END) c) x$f$, rcols);
END $$;
SET session_replication_role = origin;
VACUUM ANALYZE rides; VACUUM ANALYZE users;
SELECT route_category IS NOT NULL c, count(*), count(DISTINCT user_id) FROM rides GROUP BY 1;
SELECT pg_size_pretty(pg_relation_size('rides')) heap, pg_size_pretty(pg_total_relation_size('rides')) total;
