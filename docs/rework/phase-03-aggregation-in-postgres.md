# Phase 03 — Move aggregation into Postgres (kill the 1102s)

## Goal
No request handler does work proportional to the number of rides. Every table and chart is served by one SQL function that takes a `TableQuery` and returns exactly the page requested. A leaderboard page view makes ≤ 3 Supabase requests instead of 25–30. Error 1102 rate on the site is zero.

## Why
Handlers page whole tables (18 pages of `rides` per leaderboard load) and aggregate in JS under a 10 ms CPU / 50-subrequest cap (F1.1). Three code paths compute "the leaderboard" differently (F1.2). Eight prior commits capped symptoms; the pattern never changed (F1.3). Postgres at 65k rows answers all of this in tens of milliseconds (F1.4).

## Prerequisites
- Phase 02 merged (goldens exist, `pnpm test:db` works). Phase 05a (`TableQuery` schema) can land before or alongside 03a — if it hasn't, 03a defines `TableQuery` in `app/lib/table-query.ts` per ADR-4 and 05a adopts it.

## Scope
Split into four PRs, each independently deployable:

### 03a — Riders leaderboard
- In: `supabase/migrations/037_get_leaderboard.sql`, `app/lib/table-query.ts` (if not yet present), `app/server/leaderboard.ts` (`fetchLeaderboard`, remove `fetchFilteredLeaderboard`, `fetchPprDawnRiderIds`, `fetchCompanyRiderIds`), `app/routes/leaderboard.tsx` (riders view wiring only), tests.
- Out: other views, UI components, URL schema changes beyond what the wiring needs.

### 03b — Rides, All-time, growth and community charts
- In: `038_get_rides.sql`, `039_get_alltime.sql`, `040_get_growth_and_community.sql`; `app/server/rides.ts`, `alltime.ts`, `leaderboard.ts` (growth/community/route-speed), `app/queries/*`.

### 03c — Profile
- In: `041_get_profile.sql`; `app/routes/profile/$userId.tsx` data loading, `app/server/rides.ts#fetchUserRides`, `users.ts`. Resolves the 573-vs-833 discrepancy by defining both numbers in SQL with explicit names (`sf2g_rides_all_time`, `sf2g_rides_excl_weekends`, …) and labeling them in the UI.

### 03d — Network and group rides
- In: `042_network_edges.sql` (a `rider_edges` summary table refreshed by the sync pipeline / `refresh_ride_co_occurrences`), `043_get_group_rides.sql`; `app/server/network.ts`, `group-rides.ts` listing path (not the compute path — that moves in Phase 04). `/network` stops fetching 7,000 rows with polylines on every visit.

## Steps (pattern for every function; 03a shown)
1. **Write the SQL function** `get_leaderboard(q jsonb) RETURNS TABLE(... , total_count bigint)` as `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`. Inputs read from `q`: `routes text[]`, `include_other`, `date_from`, `date_to`, `exclude_weekends`, `ppr_dawn`, `reverse`, `company`, `rider_ids`, `search`, `sort_column`, `sort_dir`, `page`, `page_size`. Implement:
   - a CTE `eligible_rides` applying every filter once (route via `COALESCE(o.override_route_category, r.route_category)`, hidden/override exclusion, weekend via `EXTRACT(dow FROM ride_date)`, PPR via join to `ppr_dawn_rides`, reverse via the existing `getCommuteDirection` logic ported to SQL — or a precomputed `direction` column added by migration and backfilled, preferred);
   - per-rider aggregates (counts per route, totals, `percentile_cont(0.5)` medians, averages, years active, last ride);
   - `ORDER BY` through a `CASE` on `sort_column` with `NULLS LAST`, `LIMIT/OFFSET`, and `count(*) OVER ()` as `total_count`.
   - Grant `EXECUTE` to `anon, authenticated` (read-only, invoker rights; RLS already allows reads).
2. **Indexes** (same migration): `rides(user_id, ride_date)`, `rides(ride_date) WHERE route_category IS NOT NULL`, `rides(destination_company)`, and drop the four unused indexes from F5.4 only after confirming with `EXPLAIN` that nothing new uses them.
3. **Golden test first:** add `app/server/__test__/db/get_leaderboard.test.ts` that runs the same input matrix as the characterization test and compares against the Phase 02 snapshots. Expect green for inputs where the old paths agreed; for entries in `KNOWN_DISCREPANCIES.md`, assert the SQL answer equals the **hand-computed** fixture total, update the snapshot, and note it in the PR.
4. **Rewire the server function:** `fetchLeaderboard = createServerFn().validator(TableQuery).handler(({data}) => supabase.rpc('get_leaderboard', { q: data }))`. Delete the JS aggregation, the pagination loops, and the client-side PPR/company ID intersections in `leaderboard.tsx`.
5. **Measure.** Add `app/lib/perf.ts` with `withTiming(name, fn)` logging `performance.now()` deltas and the Supabase request count per server fn (count calls in a tiny wrapper around the client's `fetch`). Log one line per request: `[perf] fetchLeaderboard subreq=1 ms=84`. Keep this permanently; it is cheap.
6. **E2E:** extend `e2e/pages.spec.ts` to click each filter chip on the riders view and assert the table re-renders with a row count equal to `total_count` from the network response.
7. Repeat 1–6 for each function in 03b–03d. For charts, return pre-bucketed series (`month`, `count` per route) — never raw rides.

## Acceptance criteria (per sub-phase, then overall)
- [ ] For the fixture DB, every golden from Phase 02 either matches or has a documented, hand-verified correction.
- [ ] `[perf]` logs on local dev: every server fn ≤ 3 subrequests; `fetchLeaderboard`, `fetchRidesLeaderboard`, `fetchAllTimeLeaderboard`, `fetchRiderNetwork` each ≤ 2.
- [ ] Supabase edge logs after deploy: no `offset=1000` or higher appears for `rides`, `ppr_dawn_rides`, `monthly_ride_stats`, `ride_co_occurrences` under normal browsing.
- [ ] Cloudflare dashboard: 1102/"exceeded resources" errors = 0 over 7 days for all routes (03d done).
- [ ] `/network` first paint < 2 s on local dev with the fixture; < 4 s on prod.
- [ ] Removed code: `fetchFilteredLeaderboard`, `fetchPprDawnRiderIds`, `fetchCompanyRiderIds`, all `while (hasMore)` loops in `app/server/*.ts` (`grep -rn "hasMore" app/server` → 0).

## Verification
```bash
pnpm db:reset && pnpm test:db          # goldens
pnpm dev                                 # watch [perf] lines while clicking filters
pnpm e2e
supabase db push --linked                # Phillip, after review
```

## Risks & rollback
- SQL semantics drift from the old JS (weekend boundaries, timezone of `ride_date`, what counts as `other`). The goldens and the hand-computed fixture totals are the guard; discrepancies are decided explicitly in the PR, not silently.
- Functions are additive: old server functions keep working until the rewire commit in the same PR; rollback is reverting the PR (the new SQL functions are harmless if unused).
- `percentile_cont` over large per-rider sets is fine at this scale; if an EXPLAIN shows > 200 ms, materialize per-rider medians in a summary table refreshed by sync (Phase 04 has the hook).

## Size
03a ~600 lines (SQL + tests + deletions). 03b ~700. 03c ~400. 03d ~500. Four PRs.
