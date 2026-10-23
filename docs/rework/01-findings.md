# 01 — Findings: root causes with evidence

Researched 2026-10-22 against the live repo (`main` @ `a6e4fdf`), production Supabase (read-only SQL + logs), GitHub Actions history, and the running app on localhost. Each finding is tagged **VERIFIED** (observed directly) or **HYPOTHESIS** (consistent with evidence, not yet observed).

## 0. Production facts (VERIFIED, 2026-10-23 01:20 UTC)

| Fact | Value |
|---|---|
| Users | 70 |
| Rides | 65,513 (7,035 classified as an SF2G route, rest `other`/null) |
| Group rides / members | 1,473 / 1,200 |
| Ride streams cached | 60 |
| Supabase | Free plan, Postgres 17.6, project `dgoqjrfjrzewplwayhhz` (us-east-2). Local `supabase/config.toml` still says `major_version = 15`. |
| Cloudflare | Free plan (Phillip, 2026-10-22). Must stay free. |
| Traffic | ~315 Supabase REST requests in 24 h, most of them from one audit session. Low traffic; the problems are per-request cost, not volume. |
| Riders with a valid Strava token | **1 of 70** (Phillip). All 69 others: `strava_token_expires_at < now()`, `consecutive_sync_failures = 0`, `last_sync_error = NULL`. |
| Riders never synced successfully (`last_sync_at IS NULL`) | 11, including 8 with 600–2,529 rides already imported (initial sync died before writing `last_sync_at`). |
| Most recent `last_sync_at` other than Phillip | Matthew Leopold 2026-10-19, Sixuan Lou 2026-10-07, Matt Levenson 2026-10-06, then Aug and earlier. Simon Bernal: 2026-07-26. |
| Scopes | 69/70 have `read,activity:read_all`; 1 user (Sai Kiran Gorthi) has empty scopes → the only rider who genuinely needs to re-authorize. |

Platform limits that bound every design decision (from Cloudflare and Strava docs, checked 2026-10-22):

- **Workers Free:** 10 ms CPU per request *and* per Cron Trigger invocation (time waiting on `fetch`/DB does not count); **50 subrequests per invocation** (every Supabase REST call and every Strava call is one); 5 Cron Triggers per account; `waitUntil` extends life ~30 s after the response. Paid is off the table.
- **Strava:** per *application* 200 req/15 min and 2,000/day overall; **100 req/15 min and 1,000/day for non-upload (read) endpoints**. Resets at :00/:15/:30/:45 and midnight UTC. 429 on breach; over-limit requests still count toward the daily total.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits), [Strava rate limits](https://developers.strava.com/docs/rate-limits/).

---

## P2 first, because it is the biggest and the clearest: rides are not being picked up

### F2.1 — The scheduled sync never runs. (VERIFIED)

`app/routes/api/cron.ts` validates `CRON_SECRET`, then:

```ts
runCronJobs().then(...).catch(...)   // not awaited, no ctx.waitUntil
return new Response(JSON.stringify({ status: "accepted" }), { status: 202 })
```

On Cloudflare Workers a promise left dangling after the response is returned is cancelled with the invocation. Nothing in `app/` uses `waitUntil` (`grep -rn waitUntil app` → empty). Evidence that the work does not happen:

- GitHub Actions "Cron — Sync All Users" runs report `success` (last: 2026-10-23 01:11 UTC) because the workflow only checks for a 2xx, and 202 is returned instantly.
- Supabase edge logs for 01:05–01:40 UTC contain **no** cron-shaped queries: no `users?select=id,display_name,strava_refresh_token,last_sync_at`, no `PATCH users`, no ride upserts. Every request in that window is a leaderboard/profile page load.
- 24-hour totals: 1 `PATCH /rest/v1/users`, 1 `POST /rest/v1/rides`, 0 token-refresh side effects — i.e. only Phillip's own interactive sync (`app/server/trigger-sync.ts`, 5-minute cooldown, runs when he visits).
- `consecutive_sync_failures` is 0 for every user. The failure counter lives inside `syncAllUsers`; if the loop ran against 69 expired tokens and failed, it would not be 0 everywhere. (Expired *access* tokens are normal; `ensureValidToken` refreshes them. The point is that nothing even tried.)

**Consequence:** every rider except Phillip has been frozen since their last manual visit. Simon's last imported ride is 2026-07-25. Phillip's Oct 20/21 Skyline rides have no co-riders in the DB because the co-riders' rides were never fetched. This single bug accounts for most of "it doesn't pick up everyone's rides."

### F2.2 — Even if it ran, the schedule has ~20 % of the assumed capacity. (VERIFIED)

`cron.yml` schedules hourly, but GitHub delivered 5 runs in the last 24 h (07:05, 13:26, 18:17, 22:05, 01:11 UTC). `CRON_SYNC_BUDGET.MAX_USERS_PER_RUN = 6` (`app/lib/constants.ts:437`) → ~30 user-syncs/day, not the 144 the comments assume. GitHub Actions `schedule` is best-effort and is the wrong tool for this.

### F2.3 — Initial syncs are truncated and leave users in a half-synced state. (VERIFIED)

`app/server/sync.ts:53 MAX_PAGES_PER_SYNC = 5` (× 200 activities). 8 users have 600–2,529 rides *and* `last_sync_at IS NULL` — the import wrote rides but the request died (1102) before the final `users` update. Because `last_activity_at` is also null, a later incremental sync would start from scratch and hit the same wall. There is no cursor/resume.

### F2.4 — The webhook does heavy work before acknowledging, and its subscription is unverified. (VERIFIED code / HYPOTHESIS on subscription)

`app/routes/api/webhook.ts:94` `await processWebhookEvent(event)` → `ensureValidToken` (1–2 subrequests) → `fetchSingleActivity` → classify → upsert → optional refreshes, all before the 200. A 1102 here drops the event; Strava retries only briefly. The route carries `TODO: Consider adding subscription_id validation once the subscription is created and the ID is known`, which suggests no subscription has been registered. **Must verify** with the production client credentials:

```bash
curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=$STRAVA_CLIENT_ID -d client_secret=$STRAVA_CLIENT_SECRET
```

### F2.5 — Re-authorization is almost never needed. (VERIFIED)

Strava refresh tokens do not expire from disuse; `ensureValidToken` (`app/lib/strava-oauth.ts:185`) refreshes and stores rotated tokens correctly. 69/70 users have the required `activity:read_all` scope. So a working scheduler should resume everyone without a re-login — matching Phillip's constraint. Only the one empty-scope user needs the "Reconnect Strava" prompt.

### F2.6 — Group-ride detection was weakened under CPU pressure. (VERIFIED)

Commit `3606e06` removed the polyline-overlap layer from `computeAndStoreGroupRides` because "polyline decoding + haversine for 1700+ pairs is too CPU-heavy for Cloudflare Workers." Detection now relies on the `ride_co_occurrences` MV (same date + route + time-window). That is probably fine for recall; it may over-group. Not the cause of missing rides (F2.1 is), but it shows the pattern: correctness traded for the 10 ms budget.

---

## P1 — Cloudflare 1102 (Worker exceeded resource limits)

### F1.1 — Request handlers stream whole tables into the Worker and aggregate in JS. (VERIFIED)

One leaderboard page load, captured in Supabase edge logs (01:10–01:21 UTC):

- `GET /rest/v1/rides?select=user_id,start_date&route_category=not.is.null&offset=0..8000&limit=1000` — **9 pages**
- `GET /rest/v1/rides?select=user_id,ride_date&...` — **9 pages** (same rows, second shape)
- `GET /rest/v1/ppr_dawn_rides?...` — paged (115 calls/24 h, second most frequent endpoint)
- `GET /rest/v1/leaderboard_view` ×2–3, `monthly_ride_stats` paged, `users`.

That is **25–30 subrequests per page view** against a hard cap of 50, plus JS to merge ~18,000 rows, compute medians, streaks, start-hour histograms, and decode polylines for the PPR filter. The 10 ms CPU budget is exhausted by any filter combination that falls off the materialized-view fast path. Callers: `app/server/rides.ts:372 fetchCommunityStartHours` and `:493 fetchCommunityStreaks`, `leaderboard.ts:677 fetchPprDawnRiderIds`, `:852 fetchRiderGrowthData`, `:894 fetchDailyGrowthData`, `:199 fetchFilteredLeaderboard`, `alltime.ts:64 fetchAllTimeLeaderboard`, `network.ts:93 fetchRiderNetwork` (7 pages of `ride_co_occurrences` *with both polylines* on every `/network` visit → the 5–12 s load).

### F1.2 — Three different code paths compute "the leaderboard". (VERIFIED)

`fetchLeaderboard` (`leaderboard.ts:92`): (a) no date → `leaderboard_view` MV; (b) date range → RPC `get_leaderboard_by_date_range`; (c) route/company/date compound → `fetchFilteredLeaderboard` fetches rides and aggregates in JS. Each path has its own weekend handling, `other` handling, PPR intersection (done client-side by ID set), and sort/null semantics. This is both the CPU problem and the P3 "shows the wrong thing" problem: the same filter can yield different numbers depending on which branch ran.

### F1.3 — History: 8 of 73 commits are 1102 point-fixes. (VERIFIED)

`c83d95d`, `3606e06`, `a67701b`, `192f23a`, `dbdece6`, `bd4655c`, `a6e4fdf`, `4829b8f`. Each one caps, paginates, or skips a specific computation. None moves aggregation into Postgres, which already holds the data and is idle (checkpoints only in `postgres_logs`; REST latencies 100–500 ms, dominated by payload size).

### F1.4 — Postgres can do all of it cheaply. (VERIFIED by scale)

65k rides is a small table. Every number the UI shows (per-rider counts by route, medians, averages, streaks, start-hour buckets, monthly growth, PPR-at-dawn membership, co-ride pairs) is a `GROUP BY` or window function over indexed columns. The schema already has the right MVs (`leaderboard_view`, `ppr_dawn_rides`, `ride_co_occurrences`, `route_speed_leaderboard`, `company_leaderboard_view`); what is missing is **parameterized** aggregation (filters as RPC arguments) and **server-side pagination/sort**, so the Worker returns ≤ 1 subrequest of ≤ 100 rows per table.

---

## P3 — Tables are painful and buggy

### F3.1 — State is split and partially duplicated. (VERIFIED)

`app/routes/leaderboard.tsx` (1,046 lines) owns a 23-field `LeaderboardSearch` in the URL (`validateSearch` hand-parses every field; no schema) plus `useState` for selected riders, mobile panels, and "has initialized selection". Four views (riders/rides/alltime/groups) share one route and one search object, with view-specific sort keys (`sort`/`rSort`/`gSort`, `page`/`gPage`). Filters are applied partly server-side (per path, F1.2) and partly client-side (PPR set intersection, company rider IDs, search text). Column definitions (`LeaderboardColumns.tsx`, 710 lines) embed formatting, unit conversion, and sort comparators.

### F3.2 — Observed inconsistencies. (VERIFIED in browser, 2026-10-22)

- Profile header: **573 SF2G rides / 21,642 mi**; "SF2G Stats" card on the same page: **833 / 22,475 mi**. Two definitions, unexplained.
- Two "Groups" buttons in the DOM (desktop + mobile nav rendered simultaneously); the first is not clickable.
- Profile "Average departure time 9:58 AM" for a dawn commuter → `start_date` (UTC) vs `start_date_local`/`timezone` confusion; the same bug class as F5.1.
- 20+ table-related fix commits (column widths, resize vs sort, jitter, truncation, null sorting, server sort allow-list), each addressing a symptom of having no shared table shell.

### F3.3 — No contract between filter state and server. (VERIFIED)

Server functions accept loose objects and re-validate ad hoc (`VALID_LEADERBOARD_SORT_COLUMNS`, `isValidDateString`, route allow-lists duplicated in `rides.ts` and `leaderboard.ts`). There is no single `TableQuery` type shared by URL, client, and server.

---

## P4 — Tests

### F4.1 — 440 tests exist, none can catch a wrong number on screen. (VERIFIED)

11 files under `app/lib/__test__` and `app/server/__test__`: route classifier, destination classifier, date utils, leaderboard filter helpers, group-ride clustering, a few regression files (`bug-fixes`, `truncation-bugs`). All pure functions with inline fixtures. No database tests, no component tests, no end-to-end tests, no CI (the only workflow is the cron). `typecheck` was failing on a fresh clone until `pnpm dev` generated route types.

---

## P5 — Everything else found in the audit

- **F5.1 Timezone hydration bug (VERIFIED):** `/should-i-sf2g` and `/2sf2g` throw a React hydration mismatch in the evening Pacific time — server (UTC) renders day pills one day ahead of the client ("Sat" vs "Sun"). Any `new Date()`-derived label must be computed in `America/Los_Angeles` on both sides, or rendered client-only.
- **F5.2 Security (VERIFIED via Supabase advisors):** `batch_update_ride_classifications(jsonb)`, `refresh_leaderboard()`, `refresh_company_leaderboard()`, `refresh_ppr_dawn_rides()`, `refresh_ride_co_occurrences()` are `SECURITY DEFINER` and executable by `anon` and `authenticated` over `/rest/v1/rpc/*`. The anon key is public (it ships in the client bundle). App code calls them only via the service-role client (`app/server/reclassify.ts`, `sync.ts`, `auth.ts`, `ride-overrides.ts`), so revoking is safe. Also: 10 functions with mutable `search_path`; 5 MVs selectable by anon; `/api/cron` and `/api/webhook` carry security TODOs.
- **F5.3 Map tiles (VERIFIED):** `/routes` Leaflet tiles render "API KEY REQUIRED" watermarks — the tile provider changed terms or the key was never set.
- **F5.4 Perf advisor:** unindexed FK `ride_overrides.user_id`; unused indexes `idx_users_strava_id`, `idx_rides_strava_activity_id`, `idx_rides_start_date`, `idx_rides_has_power`.
- **F5.5 Repo hygiene:** `GEMINI.md`, `.agent/`, `swarm_session/`, `Egan Scraper.md` at root; no `CLAUDE.md`; migration numbering skips `022`; `.env.example` documents `APP_URL` but not `CRON_SECRET`.
- **F5.6 Local dev points at production.** `.env.local` on this machine uses the prod anon key because no dev database exists. Any write path exercised locally (sync, reclassify, overrides, DevTools "Run All Cron Jobs") hits sf2ging.com data.
- **F5.7 Profile charts:** categorical x-axis drops missing years (2013–2016) silently; profile page `<title>` is the generic site title.

---

## What this means for priorities

1. **F2.1 is a one-file bug with a one-day fix** that restores sync for 69 riders without anyone re-authorizing. Do it first (Phase 1), before the architecture work.
2. **F1.1/F1.2 and F3.1/F3.3 are the same problem** seen from two sides: there is no single query model answered by the database. Fixing it once (Phases 3 and 5) removes the 1102s *and* the "wrong numbers".
3. **F4.1 must come before the refactor**, as characterization tests on a fixture database, or "the numbers changed" will be undetectable.
